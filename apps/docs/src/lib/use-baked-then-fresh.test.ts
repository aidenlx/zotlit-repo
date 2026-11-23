import { expect, it } from "vitest";

import { currentFact } from "./use-baked-then-fresh.ts";

it.each([
  { shows: "the fresh fact once it lands", baked: "b", fresh: "f", fact: "f" },
  {
    shows: "the baked fact before a refresh",
    baked: "b",
    fresh: null,
    fact: "b",
  },
  {
    shows: "no fact without a baked fact",
    baked: null,
    fresh: "f",
    fact: null,
  },
])("shows $shows", ({ baked, fresh, fact }) => {
  expect(currentFact(baked, fresh)).toBe(fact);
});
