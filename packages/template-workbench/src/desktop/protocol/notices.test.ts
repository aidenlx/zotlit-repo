import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { LinkOutcome } from "@zotlit/plugin-services/obsidian/protocol/outcome.ts";

import { showWorkbenchLinkOutcome } from "./notices.ts";

const noticesOf = Effect.fn("noticesOf")(function* (outcome: LinkOutcome) {
  const notifier = testNotifier();
  yield* showWorkbenchLinkOutcome(outcome).pipe(
    Effect.provideService(Notifier, notifier.service),
  );
  return notifier.notices.map(({ messages: [message], duration }) => ({
    message,
    duration,
  }));
});

describe("showWorkbenchLinkOutcome", () => {
  it.effect.each([
    [LinkOutcome.InvalidLink(), m.notice_protocol_invalid()],
  ] as const)("tells a refused link: %o", ([outcome, message]) =>
    Effect.gen(function* () {
      expect(yield* noticesOf(outcome)).toEqual([
        { message, duration: undefined },
      ]);
    }),
  );

  it.effect.each([LinkOutcome.Opened()])("shows nothing for %o", (outcome) =>
    Effect.gen(function* () {
      expect(yield* noticesOf(outcome)).toEqual([]);
    }),
  );
});
