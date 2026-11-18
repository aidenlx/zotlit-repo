import { describe, expect, it } from "@effect/vitest";
import { Cause, Context, Effect, Exit } from "effect";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { clearExcerptCache, reportClearExcerptCache } from "./clear-cache.ts";
import { ExcerptDisplays } from "./display.ts";

import { ExcerptImageService } from "#obsidian/excerpt-image/service.ts";

type Mode = "cancel" | "clear" | "failure";

/** The user's answer to the confirmation, as `awaitConfirm` gives it. */
const answer = (mode: Mode) => Effect.succeed(mode !== "cancel");

describe("clearExcerptCache", () => {
  it.effect.each(["cancel", "clear", "failure"] as const)(
    "releases the displays, then empties the store: %s",
    (mode) =>
      Effect.gen(function* () {
        const calls: string[] = [];
        const exit = yield* clearExcerptCache(answer(mode)).pipe(
          Effect.exit,
          Effect.provideContext(
            Context.make(Notifier, testNotifier().service).pipe(
              Context.add(
                ExcerptDisplays,
                stubService<ExcerptDisplays["Service"]>("ExcerptDisplays", {
                  clear: Effect.sync(() => void calls.push("displays")),
                }),
              ),
              Context.add(
                ExcerptImageService,
                stubService<ExcerptImageService["Service"]>("ExcerptImages", {
                  clear: Effect.tryPromise(async () => {
                    calls.push("images");
                    if (mode === "failure") throw new Error("storage blocked");
                  }),
                }),
              ),
            ),
          ),
        );

        expect(calls).toEqual(mode === "cancel" ? [] : ["displays", "images"]);
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
            ExcerptDisplays,
            stubService<ExcerptDisplays["Service"]>("ExcerptDisplays", {
              clear: Effect.void,
            }),
          ),
          Context.add(
            ExcerptImageService,
            stubService<ExcerptImageService["Service"]>("ExcerptImages", {
              clear:
                mode === "failure"
                  ? Effect.fail(
                      new Cause.UnknownError(new Error("storage blocked")),
                    )
                  : Effect.void,
            }),
          ),
        );
        yield* reportClearExcerptCache(answer(mode)).pipe(
          Effect.provideContext(services),
        );
        expect(notifier.notices.map((notice) => notice.messages[0])).toEqual(
          mode === "cancel"
            ? []
            : mode === "failure"
              ? [m.notice_excerpt_cache_clear_failed()]
              : [m.notice_excerpt_cache_cleared()],
        );
      }),
  );
});
