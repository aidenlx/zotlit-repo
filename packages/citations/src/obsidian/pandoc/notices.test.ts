import { it } from "@effect/vitest";
import { Effect, Exit, Scope, Stream } from "effect";
import { describe, expect, it as plainIt, vi } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { testEvent } from "@zotlit/plugin-kernel/__fixtures__/event-stream.ts";

import {
  citationStyleMissingNotice,
  watchCitationStyleMissing,
} from "./notices.ts";
import type { BibliographyRenderState } from "./render-cache.ts";

function styleEvents(existing = false) {
  const event = testEvent<BibliographyRenderState>();
  const stateOf = (missingStyle: string | null): BibliographyRenderState => ({
    vaultPresentation: {} as BibliographyRenderState["vaultPresentation"],
    missingStyle,
  });
  const style = "http://www.zotero.org/styles/missing";
  return {
    cache: {
      changes: Stream.unwrap(
        Effect.sync(() =>
          event.stream.pipe(Stream.prepend([stateOf(existing ? style : null)])),
        ),
      ),
    },
    emit: (missingStyle: string | null = style) =>
      event.emit(stateOf(missingStyle)),
    hasListener: () => event.subscribers > 0,
  };
}

describe("citationStyleMissingNotice", () => {
  plainIt(
    "carries the approved copy and opens settings through its action",
    () => {
      const openSettings = vi.fn();
      const notice = citationStyleMissingNotice(openSettings);

      expect(notice).toMatchObject({
        title:
          "The selected citation and references style isn’t installed in Zotero.",
        action: "Open settings",
      });

      notice.openSettings();
      expect(openSettings).toHaveBeenCalledOnce();
    },
  );
});

describe("watchCitationStyleMissing", () => {
  it.effect(
    "shows a notice when the missing style was found before the start",
    () =>
      Effect.gen(function* () {
        const events = styleEvents(true);
        const notifier = testNotifier();
        const showNotice = notifier.service.show("Style missing", {
          duration: 0,
        });
        const watched = yield* Scope.make();
        yield* watchCitationStyleMissing(events.cache, showNotice).pipe(
          Scope.provide(watched),
        );

        expect(notifier.notices).toMatchObject([{ hidden: false }]);
        yield* Scope.close(watched, Exit.void);
        expect(notifier.notices).toMatchObject([{ hidden: true }]);
        expect(events.hasListener()).toBe(false);
      }),
  );

  it.effect(
    "watches for the plugin lifecycle and hides the active notice at its end",
    () =>
      Effect.gen(function* () {
        const events = styleEvents();
        const notifier = testNotifier();
        const showNotice = notifier.service.show("Style missing", {
          duration: 0,
        });
        const watched = yield* Scope.make();
        yield* watchCitationStyleMissing(events.cache, showNotice).pipe(
          Scope.provide(watched),
        );

        events.emit();
        expect(notifier.notices).toMatchObject([{ hidden: false }]);

        yield* Scope.close(watched, Exit.void);
        expect(notifier.notices).toMatchObject([{ hidden: true }]);
        expect(events.hasListener()).toBe(false);
      }),
  );

  it.effect("hides the superseded notice before the watcher closes", () =>
    Effect.gen(function* () {
      const events = styleEvents();
      const notifier = testNotifier();
      const showNotice = notifier.service.show("Style missing", {
        duration: 0,
      });
      const watched = yield* Scope.fork(yield* Scope.Scope);
      yield* watchCitationStyleMissing(events.cache, showNotice).pipe(
        Scope.provide(watched),
      );

      events.emit("http://www.zotero.org/styles/missing-a");
      expect(notifier.notices).toMatchObject([{ hidden: false }]);
      events.emit("http://www.zotero.org/styles/missing-b");
      expect
        .soft(notifier.notices)
        .toMatchObject([{ hidden: true }, { hidden: false }]);

      yield* Scope.close(watched, Exit.void);
      expect(notifier.notices).toMatchObject([
        { hidden: true },
        { hidden: true },
      ]);
    }),
  );

  it.effect("hides its notice when the missing style is repaired", () =>
    Effect.gen(function* () {
      const events = styleEvents();
      const notifier = testNotifier();
      const showNotice = notifier.service.show("Style missing", {
        duration: 0,
      });
      const watched = yield* Scope.fork(yield* Scope.Scope);
      yield* watchCitationStyleMissing(events.cache, showNotice).pipe(
        Scope.provide(watched),
      );

      events.emit();
      expect(notifier.notices).toMatchObject([{ hidden: false }]);
      events.emit(null);
      expect(notifier.notices).toMatchObject([{ hidden: true }]);
      events.emit();
      expect(notifier.notices).toMatchObject([
        { hidden: true },
        { hidden: false },
      ]);

      yield* Scope.close(watched, Exit.void);
    }),
  );
});
