import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Exit } from "effect";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { reportResetCitationIndex, resetCitationIndex } from "./reset.ts";
import { CitationIndex } from "./service.ts";

type Mode = "cancel" | "clear" | "failure";

const answer = (mode: Mode) => Effect.succeed(mode !== "cancel");

describe("resetCitationIndex", () => {
  it.effect.each(["cancel", "clear", "failure"] as const)(
    "resets the index behind the confirmation: %s",
    (mode) =>
      Effect.gen(function* () {
        let resets = 0;
        const exit = yield* resetCitationIndex(answer(mode)).pipe(
          Effect.exit,
          Effect.provideContext(
            Context.make(Notifier, testNotifier().service).pipe(
              Context.add(
                CitationIndex,
                stubService<CitationIndex["Service"]>("CitationIndex", {
                  reset: Effect.suspend(() => {
                    resets++;
                    return mode === "failure"
                      ? Effect.die(new Error("store locked"))
                      : Effect.void;
                  }),
                }),
              ),
            ),
          ),
        );

        expect(resets).toBe(mode === "cancel" ? 0 : 1);
        if (mode === "failure") expect(Exit.isFailure(exit)).toBe(true);
        else
          expect(exit).toEqual(
            Exit.succeed(mode === "cancel" ? "cancelled" : "completed"),
          );
      }),
  );
});

describe("recovery notices", () => {
  it.effect.each(["cancel", "clear", "failure"] as const)(
    "reports each recovery result and stays silent on cancellation: %s",
    (mode) =>
      Effect.gen(function* () {
        const notifier = testNotifier();
        const services = Context.make(Notifier, notifier.service).pipe(
          Context.add(
            CitationIndex,
            stubService<CitationIndex["Service"]>("CitationIndex", {
              reset:
                mode === "failure"
                  ? Effect.die(new Error("store locked"))
                  : Effect.void,
            }),
          ),
        );
        yield* reportResetCitationIndex(answer(mode)).pipe(
          Effect.provideContext(services),
        );
        expect(notifier.notices.map((notice) => notice.messages[0])).toEqual(
          mode === "cancel"
            ? []
            : mode === "failure"
              ? [m.notice_citation_index_reset_failed()]
              : [m.notice_citation_index_reset()],
        );
      }),
  );
});
