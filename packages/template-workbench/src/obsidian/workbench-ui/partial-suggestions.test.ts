import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";

import * as m from "@zotlit/plugin-messages/messages.ts";

import { partialSuggestions } from "./partial-suggestions.ts";

describe("partialSuggestions", () => {
  it("takes the vault's registered names over the draft's own scan", () => {
    const config = partialSuggestions(["cite"], {
      partials: {
        names: () => ["authors", "venue-line"],
        create: () => Effect.succeed(null),
      },
      start: () => {},
    });

    expect(config.partials).toEqual(["authors", "venue-line"]);
    expect(config.createPartial?.label).toBe(m.workbench_partial_new());
  });

  it("falls back to the draft's scan and offers no create entry", () => {
    const config = partialSuggestions(["cite", "summary"], {
      partials: undefined,
      start: () => {},
    });

    expect(config.partials).toEqual(["cite", "summary"]);
    expect(config.createPartial).toBeUndefined();
  });

  it.effect("hands the create flow the name the reader typed", () =>
    Effect.gen(function* () {
      const asked: string[] = [];
      const config = partialSuggestions([], {
        partials: {
          names: () => [],
          create: (query) => {
            asked.push(query);
            return Effect.succeed("venue-line");
          },
        },
        start: () => {},
      });

      expect(yield* config.createPartial!.run("ven")).toBe("venue-line");
      expect(asked).toEqual(["ven"]);
    }),
  );
});
