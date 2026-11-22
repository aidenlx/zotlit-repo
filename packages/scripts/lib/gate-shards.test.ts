import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { parseGateShard, shardTestArgs } from "./gate-shards.ts";
import { RECORD_PR_WORKFLOW } from "./land.ts";
import { getWorkspaceRoot } from "./package-roots.ts";

const root = await getWorkspaceRoot(import.meta.dirname);

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

async function scheduledTests(args: readonly string[]): Promise<string[]> {
  const { stdout } = await promisify(execFile)(
    "pnpm",
    ["exec", "turbo", "run", ...args, "--dry=json"],
    { cwd: root, maxBuffer: 256 * 1024 * 1024 },
  );
  const { tasks } = JSON.parse(stdout) as {
    tasks: { taskId: string; command: string }[];
  };
  return tasks
    .filter(({ command }) => command !== "<NONEXISTENT>")
    .map(({ taskId }) => taskId)
    .filter((id) => id.endsWith("#test") || id === "//#test:eval-runtime");
}

describe("the shards of the record PR", () => {
  const { jobs } = parse(
    readFileSync(join(root, RECORD_PR_WORKFLOW), "utf8"),
  ) as { jobs: { shard: { strategy: { matrix: { shard: number[] } } } } };
  const total = jobs.shard.strategy.matrix.shard.length;

  it(
    "run each test task of the workspace in one shard, and leave no shard empty",
    { timeout: 30_000 },
    async () => {
      const [all, ...shards] = await Promise.all([
        scheduledTests(["test", "//#test:eval-runtime"]),
        ...jobs.shard.strategy.matrix.shard.map((index) =>
          scheduledTests(shardTestArgs({ index, total })),
        ),
      ]);

      expect(shards.flat().toSorted()).toEqual(all.toSorted());
      expect(shards.filter((tests) => tests.length === 0)).toEqual([]);
    },
  );
});
