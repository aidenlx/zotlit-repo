import { it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect } from "vitest";

import { makeKeyPauses } from "./key-pauses.ts";

const ADDRESS = "https://api.zotero.org";

describe("the key pauses of the Web API source", () => {
  it.effect(
    "keeps no entry for a key without a 429, keeps one while its deadline is ahead, and drops it when it is read after the deadline",
    () =>
      Effect.gen(function* () {
        const pauses = makeKeyPauses();
        const first = pauses.of(
          ADDRESS,
          Redacted.make("firstkey0000000000000000"),
        );
        const second = pauses.of(
          ADDRESS,
          Redacted.make("secondkey000000000000000"),
        );
        expect(yield* first.until).toBe(0);
        expect(yield* second.until).toBe(0);
        expect(pauses.size()).toBe(0);

        expect(yield* first.extend(60_000)).toBe(60_000);
        expect(pauses.size()).toBe(1);
        expect(yield* second.until).toBe(0);
        expect(yield* first.until).toBe(60_000);

        yield* TestClock.adjust("60 seconds");
        expect(yield* first.until).toBe(0);
        expect(pauses.size()).toBe(0);
      }),
  );
});
