import { describe, expect, it } from "vitest";

import { planShards } from "./shard-plan.ts";

describe("the End-to-end Run shard plan", () => {
  it("puts the slowest files in different shards and balances the rest", () => {
    expect(
      planShards(
        [
          { id: "src/a.e2e.ts", ms: 190 },
          { id: "src/b.e2e.ts", ms: 140 },
          { id: "src/c.e2e.ts", ms: 90 },
          { id: "src/d.e2e.ts", ms: 60 },
          { id: "src/e.e2e.ts", ms: 40 },
        ],
        2,
      ),
    ).toEqual([
      ["src/a.e2e.ts", "src/d.e2e.ts"],
      ["src/b.e2e.ts", "src/c.e2e.ts", "src/e.e2e.ts"],
    ]);
  });

  it("weighs a file with no measured time as the median file", () => {
    expect(
      planShards(
        [
          { id: "src/new.e2e.ts", ms: undefined },
          { id: "src/a.e2e.ts", ms: 100 },
          { id: "src/b.e2e.ts", ms: 50 },
          { id: "src/c.e2e.ts", ms: 10 },
        ],
        2,
      ),
    ).toEqual([
      ["src/a.e2e.ts", "src/c.e2e.ts"],
      ["src/b.e2e.ts", "src/new.e2e.ts"],
    ]);
  });

  it("places every file in exactly one shard", () => {
    const files = Array.from({ length: 7 }, (_, index) => ({
      id: `src/${index}.e2e.ts`,
      ms: (index % 3) * 10,
    }));
    const plan = planShards(files, 3);
    expect(plan.flat().sort()).toEqual(files.map(({ id }) => id).sort());
  });
});
