import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { describe } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { testPluginHost } from "@zotlit/obsidian-kit/__fixtures__/plugin-host.ts";
import { noticeText } from "@zotlit/obsidian-kit/notice.ts";
import { UserCancelled } from "@zotlit/plugin-kernel/user-cancel.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { layerLibrarySourceActions } from "./actions.ts";
import { LibrarySource } from "./tag.ts";

const setup = Effect.fn("setup")(function* (
  syncNow: LibrarySource["Service"]["syncNow"],
) {
  const host = testPluginHost();
  const notifier = testNotifier();
  yield* Layer.build(
    layerLibrarySourceActions.pipe(
      Layer.provide([
        notifier.layer,
        host.layer,
        Layer.mock(LibrarySource)({ active: "web-api", reads: null, syncNow }),
      ]),
    ),
  );
  const run = Effect.forkChild(
    Effect.promise(async () => {
      await host.commands.get("sync-online-library")!.callback!();
    }),
    { startImmediately: true },
  );
  return { notices: notifier.notices, run };
});

describe("the command that syncs the online library", () => {
  it.effect(
    "leaves the progress of a long sync to the sync notice and reports only its outcome",
    () =>
      Effect.gen(function* () {
        const { notices, run } = yield* setup(Effect.sleep("5 seconds"));
        const running = yield* run;
        yield* TestClock.adjust("5 seconds");
        yield* Fiber.join(running);
        expect(
          notices.flatMap((notice) =>
            notice.messages.map((message) => noticeText(message)),
          ),
        ).toEqual([m.notice_online_synced()]);
      }).pipe(Effect.scoped),
  );

  it.effect("reports nothing for a sync that the user stopped", () =>
    Effect.gen(function* () {
      const { notices, run } = yield* setup(Effect.fail(new UserCancelled()));
      yield* Fiber.join(yield* run);
      yield* TestClock.adjust("5 seconds");
      expect(notices).toEqual([]);
    }).pipe(Effect.scoped),
  );
});
