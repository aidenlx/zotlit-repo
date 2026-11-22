import { Effect, Layer } from "effect";
import type { Scope, Stream } from "effect";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { NoticeHandle } from "@zotlit/obsidian-kit/notifier.ts";
import { revealSetting } from "@zotlit/obsidian-kit/open-settings.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { BibliographyRender, missingStyleChanges } from "./render-cache.ts";
import type { BibliographyRenderState } from "./render-cache.ts";

interface CitationStyleNoticeCopy {
  title: string;
  action: string;
  openSettings: () => void;
}

export const layerCitationStyleNotice = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const renders = yield* BibliographyRender;
    yield* watchCitationStyleMissing(
      renders,
      showCitationStyleMissing(
        citationStyleMissingNotice(() => {
          revealSetting(
            host.app,
            host.manifest.id,
            "settings_citation_references_style",
          );
        }),
      ),
    );
  }),
);

export function watchCitationStyleMissing<R>(
  renders: { readonly changes: Stream.Stream<BibliographyRenderState> },
  showNotice: Effect.Effect<NoticeHandle, never, R>,
): Effect.Effect<void, never, Scope.Scope | R> {
  return Effect.gen(function* () {
    let notice: NoticeHandle | null = null;
    yield* Effect.addFinalizer(() =>
      Effect.suspend(() => notice?.hide ?? Effect.void),
    );
    yield* forkEach(missingStyleChanges(renders.changes), () =>
      Effect.map(showNotice, (shown) => {
        notice = shown;
      }),
    );
  });
}

export function citationStyleMissingNotice(
  openSettings: () => void,
): CitationStyleNoticeCopy {
  return {
    title: m.notice_citation_style_missing(),
    action: m.notice_citation_style_missing_action(),
    openSettings,
  };
}

export const showCitationStyleMissing = Effect.fn(
  "CitationStyleNotice.showCitationStyleMissing",
)(function* (copy: CitationStyleNoticeCopy) {
  const notifier = yield* Notifier;
  const run = Effect.runSyncWith(yield* Effect.context<never>());
  let notice: NoticeHandle | null = null;
  notice = yield* notifier.show(
    BaseNotice.render((renderer) => {
      renderer.setTitle(copy.title);
      renderer.addAction((button) => {
        button
          .setButtonText(copy.action)
          .setCta()
          .onClick(() => {
            if (notice) run(notice.hide);
            copy.openSettings();
          });
      });
    }),
    { duration: 0 },
  );
  return notice;
});
