import { describe, expect, it } from "@effect/vitest";
import { Cause, Context, Effect, Exit } from "effect";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { resetLanguagePacks } from "./reset.ts";
import { LanguagePack, LanguagePackStorageFailed } from "./service.ts";

/** The user's confirmation, as `awaitConfirm` gives it. */
const confirmed = Effect.succeed(true);

describe("resetLanguagePacks", () => {
  const run = (reset: Effect.Effect<void, LanguagePackStorageFailed>) => {
    let resets = 0;
    return resetLanguagePacks(confirmed).pipe(
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
