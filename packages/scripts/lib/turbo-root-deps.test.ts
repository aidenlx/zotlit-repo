import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { getWorkspaceRoot } from "./package-roots.ts";

const root = await getWorkspaceRoot(import.meta.dirname);

interface Plan {
  globalCacheInputs: { hashOfInternalDependencies: string };
  tasks: { taskId: string; command: string }[];
}

function plan(tasks: readonly string[]): Plan {
  return JSON.parse(
    execFileSync("pnpm", ["exec", "turbo", "run", ...tasks, "--dry=json"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    }),
  ) as Plan;
}

function scheduled(tasks: readonly string[]): Set<string> {
  return new Set(
    plan(tasks)
      .tasks.filter(({ command }) => command !== "<NONEXISTENT>")
      .map(({ taskId }) => taskId),
  );
}

const TYPE_CHECK = /#typecheck(?::test|:node)?$/;

function generatorsOf(checks: readonly string[]): string[] {
  return [...scheduled(checks)].filter((task) => !TYPE_CHECK.test(task)).sort();
}

describe("turbo.json root task dependencies", () => {
  it.each([
    ["//#lint:repo:deps", ["typecheck", "typecheck:test", "typecheck:node"]],
    ["//#review:plugin:deps", ["@zotlit/obsidian#typecheck"]],
  ] as const)(
    "%s runs every generator the type checks read",
    (task, checks) => {
      const runs = scheduled([task]);
      const missing = generatorsOf(checks).filter((each) => !runs.has(each));
      expect(missing, `add these to the dependsOn of ${task}`).toEqual([]);
    },
  );

  it("the global hash holds no workspace package source", () => {
    expect(
      plan(["test"]).globalCacheInputs.hashOfInternalDependencies,
      "remove the workspace dependencies of the root package.json",
    ).toBe("");
  });
});
