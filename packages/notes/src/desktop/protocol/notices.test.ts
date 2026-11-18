import type { BatchUpdateResult } from "#desktop/note-feature/update-batch.ts";
import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { describe, expect } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { showNoteLinkOutcome } from "./notices.ts";
import { NoteLinkOutcome } from "./outcome.ts";

/** The notices `outcome` shows: each one's text and duration. */
const noticesOf = Effect.fn("noticesOf")(function* (outcome: NoteLinkOutcome) {
  const notifier = testNotifier();
  yield* showNoteLinkOutcome(outcome, {}).pipe(
    Effect.provideService(Notifier, notifier.service),
  );
  return notifier.notices.map(({ messages: [message], duration }) => ({
    message,
    duration,
  }));
});

/** A batch update run that ended with `outcome`. */
const updated = (outcome: BatchUpdateResult["outcome"]) =>
  Exit.succeed<BatchUpdateResult>({ outcome });

describe("showNoteLinkOutcome", () => {
  it.effect.each([
    [NoteLinkOutcome.InvalidLink(), m.notice_protocol_invalid()],
    [NoteLinkOutcome.DatabaseUnavailable(), m.notice_protocol_db_unavailable()],
    [NoteLinkOutcome.ItemNotFound(), m.notice_protocol_item_not_found()],
  ] as const)("tells a refused link: %o", ([outcome, message]) =>
    Effect.gen(function* () {
      expect(yield* noticesOf(outcome)).toEqual([
        { message, duration: undefined },
      ]);
    }),
  );

  it.effect("names the Profile ID that names no Profile", () =>
    Effect.gen(function* () {
      const notices = yield* noticesOf(
        NoteLinkOutcome.UnknownProfile({ text: "not-a-profile" }),
      );
      expect(notices).toHaveLength(1);
      expect(notices[0]!.message).toContain("not-a-profile");
    }),
  );

  it.effect.each([NoteLinkOutcome.ForeignSource(), NoteLinkOutcome.Opened()])(
    "shows nothing for %o",
    (outcome) =>
      Effect.gen(function* () {
        expect(yield* noticesOf(outcome)).toEqual([]);
      }),
  );

  it.effect.each([
    ["db-unavailable", m.batch_update_db_unavailable()],
    ["empty-selection", m.notice_protocol_item_not_found()],
    ["not-found", m.notice_protocol_item_not_found()],
  ] as const)(
    "tells an update-many run's %s outcome for 2 s",
    ([result, message]) =>
      Effect.gen(function* () {
        expect(
          yield* noticesOf(
            NoteLinkOutcome.UpdateMany({ exit: updated(result) }),
          ),
        ).toEqual([{ message, duration: 2000 }]);
      }),
  );

  it.effect.each([
    ["db-unavailable", m.batch_update_db_unavailable()],
    ["empty-selection", m.batch_update_all_empty()],
    ["no-library-in-scope", m.batch_all_no_library_in_scope()],
    ["unavailable-target", m.batch_all_library_unavailable()],
    ["collection-not-found", m.notice_collection_not_found()],
  ] as const)(
    "tells an update-all run's %s outcome for 2 s",
    ([result, message]) =>
      Effect.gen(function* () {
        expect(
          yield* noticesOf(
            NoteLinkOutcome.UpdateAll({ exit: updated(result) }),
          ),
        ).toEqual([{ message, duration: 2000 }]);
      }),
  );

  it.effect.each(["single-update", "batch-modal"] as const)(
    "shows nothing for an update run that reached its %s",
    (result) =>
      Effect.gen(function* () {
        expect(
          yield* noticesOf(
            NoteLinkOutcome.UpdateMany({ exit: updated(result) }),
          ),
        ).toEqual([]);
        expect(
          yield* noticesOf(
            NoteLinkOutcome.UpdateAll({ exit: updated(result) }),
          ),
        ).toEqual([]);
      }),
  );

  it.effect("shows nothing for an update run that failed", () =>
    Effect.gen(function* () {
      const exit = Exit.die(new Error("classify failed"));
      expect(yield* noticesOf(NoteLinkOutcome.UpdateMany({ exit }))).toEqual(
        [],
      );
      expect(yield* noticesOf(NoteLinkOutcome.UpdateAll({ exit }))).toEqual([]);
    }),
  );

  it.effect("tells an import run's failure for 4 s", () =>
    Effect.gen(function* () {
      const exit = Exit.die(new Error("index failed"));
      expect(yield* noticesOf(NoteLinkOutcome.ImportNotes({ exit }))).toEqual([
        { message: m.batch_import_failed(), duration: 4000 },
      ]);
      expect(
        yield* noticesOf(NoteLinkOutcome.ImportAllNotes({ exit })),
      ).toEqual([{ message: m.batch_import_failed(), duration: 4000 }]);
    }),
  );
});
