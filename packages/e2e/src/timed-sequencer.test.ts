import { describe, expect, it } from "vitest";
import type { TestSpecification, Vitest } from "vitest/node";

import { planShards } from "./shard-plan.ts";
import TimedSequencer, { TIMINGS_BASELINE } from "./timed-sequencer.ts";

const root = "/repo/packages/e2e";

function shardOf(index: number, ids: readonly string[]) {
  const ctx = {
    config: { root, shard: { index, count: 2 } },
  } as unknown as Vitest;
  const files = ids.map(
    (id) => ({ moduleId: `${root}/${id}` }) as TestSpecification,
  );
  return new TimedSequencer(ctx)
    .shard(files)
    .then((chosen) =>
      chosen.map(({ moduleId }) => moduleId.slice(root.length + 1)),
    );
}

describe("the timed sequencer", () => {
  it("splits the files by the committed baseline, each file in one shard", async () => {
    const ids = [
      "src/citation-index.e2e.ts",
      "src/library-view-long-list.e2e.ts",
      "src/reader.e2e.ts",
      "src/new.e2e.ts",
    ];
    const [first, second] = await Promise.all([
      shardOf(1, ids),
      shardOf(2, ids),
    ]);
    expect([...first, ...second].sort()).toEqual([...ids].sort());
    expect(first).toContain("src/citation-index.e2e.ts");
    expect(second).toContain("src/library-view-long-list.e2e.ts");
    expect(
      TIMINGS_BASELINE.endsWith("packages/e2e/timings-baseline.json"),
    ).toBe(true);
    expect(planShards([], 2)).toEqual([[], []]);
  });
});
