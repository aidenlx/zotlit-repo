import type { Scope } from "effect";
import { Effect, Layer } from "effect";

import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { NoticeHandle } from "@zotlit/obsidian-kit/notifier.ts";
import { revealSetting } from "@zotlit/obsidian-kit/open-settings.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { LibraryScope, scopeChanges } from "./service.ts";

interface LibraryScopeNoticeCopy {
  title: string;
  explanation: string;
  action: string;
  openSettings: () => void;
}

export const layerLibraryScopeNotices = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const scope = yield* LibraryScope;
    yield* watchLibraryScopeInvalid(
      scope,
      showLibraryScopeInvalid(
        libraryScopeInvalidNotice(() => {
          revealSetting(host.app, host.manifest.id, "settings_library_scope");
        }),
      ),
    );
  }),
);

export function watchLibraryScopeInvalid<R>(
  scope: Pick<LibraryScope["Service"], "invalid" | "changes">,
  showNotice: Effect.Effect<NoticeHandle, never, R>,
): Effect.Effect<void, never, Scope.Scope | R> {
  return Effect.gen(function* () {
    let notice: NoticeHandle | null = null;
    const apply = Effect.gen(function* () {
      if (!(yield* scope.invalid)) {
        if (notice) yield* notice.hide;
        notice = null;
        return;
      }
      notice ??= yield* showNotice;
    });
    yield* Effect.addFinalizer(() =>
      Effect.suspend(() => notice?.hide ?? Effect.void),
    );
    yield* apply;
    yield* forkEach(scopeChanges(scope.changes), () => apply);
  });
}

export function libraryScopeInvalidNotice(
  openSettings: () => void,
): LibraryScopeNoticeCopy {
  return {
    title: m.notice_library_scope_invalid(),
    explanation: m.notice_library_scope_invalid_explanation(),
    action: m.notice_library_scope_invalid_action(),
    openSettings,
  };
}

export const showLibraryScopeInvalid = Effect.fn(
  "LibraryScopeNotices.showLibraryScopeInvalid",
)(function* (copy: LibraryScopeNoticeCopy) {
  const notifier = yield* Notifier;
  return yield* notifier.show(
    {
      title: copy.title,
      lines: [copy.explanation],
      actions: [{ label: copy.action, run: copy.openSettings }],
    },
    { duration: 0 },
  );
});
