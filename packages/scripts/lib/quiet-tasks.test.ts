import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { shardTestArgs } from "./gate-shards.ts";
import { getWorkspaceRoot } from "./package-roots.ts";

const root = await getWorkspaceRoot(import.meta.dirname);

interface Plan {
  tasks: {
    taskId: string;
    command: string;
    resolvedTaskDefinition: { outputLogs: string };
  }[];
}

function plan(args: readonly string[]): Plan["tasks"] {
  const { tasks } = JSON.parse(
    execFileSync("pnpm", [...args, "--dry=json", "--cache=local:"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    }),
  ) as Plan;
  return tasks.filter(({ command }) => command !== "<NONEXISTENT>");
}

function loud(tasks: Plan["tasks"]): string[] {
  return tasks
    .filter(
      ({ resolvedTaskDefinition }) =>
        resolvedTaskDefinition.outputLogs !== "errors-only",
    )
    .map(({ taskId }) => taskId);
}

describe("a passing check prints only its summary", () => {
  it("the test tasks of pnpm test and pnpm verify log a failed task only", () => {
    const tests = plan([
      "exec",
      "turbo",
      "run",
      ...shardTestArgs({ index: 1, total: 1 }),
    ]).filter(({ taskId }) => /#test(:|$)/.test(taskId));

    expect(tests.length).toBeGreaterThan(20);
    expect(loud(tests)).toEqual([]);
  }, 60_000);

  it("the lint tasks of pnpm lint log a failed task only", () => {
    const lints = plan(["lint"]).filter(({ taskId }) =>
      taskId.startsWith("//#lint:"),
    );

    expect(lints.length).toBeGreaterThan(5);
    expect(loud(lints)).toEqual([]);
  }, 60_000);
});
