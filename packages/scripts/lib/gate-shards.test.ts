import { describe, expect, it } from "vitest";

import { parseGateShard, shardFilters } from "./gate-shards.ts";

describe("parseGateShard", () => {
  it.each([
    ["1/3", { index: 1, total: 3 }],
    ["3/3", { index: 3, total: 3 }],
  ])("reads %s", (value, shard) => {
    expect(parseGateShard(value)).toEqual(shard);
  });

  it.each(["0/3", "4/3", "1", "1/0", "1/3x", ""])("refuses %j", (value) => {
    expect(parseGateShard(value)).toBeUndefined();
  });
});

describe("shardFilters", () => {
  it("selects the tag of a shard before the last", () => {
    expect(shardFilters({ index: 2, total: 3 })).toEqual([
      "--filter=tag:ci-shard-2",
    ]);
  });

  it("leaves the last shard every task that no other shard takes", () => {
    expect(shardFilters({ index: 3, total: 3 })).toEqual([
      "--filter=!tag:ci-shard-1",
      "--filter=!tag:ci-shard-2",
    ]);
  });

  it("selects every task when there is one shard", () => {
    expect(shardFilters({ index: 1, total: 1 })).toEqual([]);
  });
});
