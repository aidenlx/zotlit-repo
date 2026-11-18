import { describe, expect, it } from "@effect/vitest";
import { Cause, Context, Effect, Exit } from "effect";

import { ExcerptDisplays } from "@zotlit/annotations/desktop/excerpt-image/display.ts";
import { ExcerptImageService } from "@zotlit/annotations/obsidian/excerpt-image/service.ts";
import { CitationIndex } from "@zotlit/citations/obsidian/citation-index/service.ts";
import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import {
  LanguagePack,
  LanguagePackStorageFailed,
} from "@zotlit/plugin-services/obsidian/language-pack/service.ts";

import {
  clearExcerptCache,
  resetCitationIndex,
  resetLanguagePacks,
  reportClearExcerptCache,
  reportResetCitationIndex,
} from "./recovery.ts";

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

describe("resetLanguagePacks", () => {
  const run = (reset: Effect.Effect<void, LanguagePackStorageFailed>) => {
    let resets = 0;
    return resetLanguagePacks(answer("clear")).pipe(
      Effect.provideContext(
        Context.make(Notifier, testNotifier().service).pipe(
          Context.add(
            LanguagePack,
            stubService<LanguagePack["Service"]>("LanguagePack", {
              reset: Effect.suspend(() => {
                resets++;
                return reset;
              }),
            }),
          ),
        ),
      ),
      Effect.exit,
      Effect.map((exit) => ({ exit, resets })),
    );
  };

  it.effect("clears the packs once confirmed", () =>
    Effect.gen(function* () {
      const { exit, resets } = yield* run(Effect.void);
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(resets).toBe(1);
    }),
  );

  it.effect("fails with the storage failure, for the tab to report", () =>
    Effect.gen(function* () {
      const failure = new LanguagePackStorageFailed({
        message: "Storage is full",
        cause: null,
      });
      const { exit } = yield* run(Effect.fail(failure));
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(failure);
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
        yield* reportClearExcerptCache(answer(mode)).pipe(
          Effect.provideContext(services),
        );
        yield* reportResetCitationIndex(answer(mode)).pipe(
          Effect.provideContext(services),
        );
        expect(notifier.notices.map((notice) => notice.messages[0])).toEqual(
          mode === "cancel"
            ? []
            : mode === "failure"
              ? [
                  m.notice_excerpt_cache_clear_failed(),
                  m.notice_citation_index_reset_failed(),
                ]
              : [
                  m.notice_excerpt_cache_cleared(),
                  m.notice_citation_index_reset(),
                ],
        );
      }),
  );
});
