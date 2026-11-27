import type { Scope } from "effect";
import { Effect, Layer, Stream } from "effect";

import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { NoticeHandle } from "@zotlit/obsidian-kit/notifier.ts";
import { revealSetting } from "@zotlit/obsidian-kit/open-settings.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { BibliographyRenderState } from "./render-cache.ts";
import { BibliographyRender } from "./render-cache.ts";

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
    const missingStyles = renders.changes.pipe(
      Stream.map((state) => state.missingStyle),
      Stream.changes,
    );
    yield* forkEach(missingStyles, (missingStyle) =>
      Effect.gen(function* () {
        if (notice !== null) yield* notice.hide;
        notice = missingStyle === null ? null : yield* showNotice;
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
  return yield* notifier.show(
    {
      title: copy.title,
      actions: [{ label: copy.action, run: copy.openSettings }],
    },
    { duration: 0 },
  );
});
