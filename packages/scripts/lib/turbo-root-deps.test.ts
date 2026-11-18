// A type-aware root task reads the files that the `generate:*` tasks write, as
// the type check of each package does. turbo.json names those generators as
// dependencies of the root task. This test holds the root task to the
// generators that the type checks depend on, so a new generated file that the
// root task misses fails here.
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { getWorkspaceRoot } from "./package-roots.ts";

const root = await getWorkspaceRoot(import.meta.dirname);

/** The tasks with a command that `turbo run <tasks>` schedules. */
function scheduled(tasks: readonly string[]): Set<string> {
  const plan = JSON.parse(
    execFileSync("pnpm", ["exec", "turbo", "run", ...tasks, "--dry=json"], {
      cwd: root,
      encoding: "utf8",
      // The plan lists the input files of every task.
      maxBuffer: 256 * 1024 * 1024,
    }),
  ) as { tasks: { taskId: string; command: string }[] };
  return new Set(
    plan.tasks
      .filter(({ command }) => command !== "<NONEXISTENT>")
      .map(({ taskId }) => taskId),
  );
}

const TYPE_CHECK = /#typecheck(?::test|:node)?$/;

/** The tasks that the type checks `checks` wait for, other than type checks. */
function generatorsOf(checks: readonly string[]): string[] {
  return [...scheduled(checks)].filter((task) => !TYPE_CHECK.test(task)).sort();
}

describe("turbo.json root task dependencies", () => {
  it.each([
    // oxlint is type-aware over the whole tree.
    ["//#lint:repo:deps", ["typecheck", "typecheck:test", "typecheck:node"]],
    // ESLint reviews the Obsidian plugin alone.
    ["//#review:plugin:deps", ["@zotlit/obsidian#typecheck"]],
  ] as const)(
    "%s runs every generator the type checks read",
    (task, checks) => {
      const runs = scheduled([task]);
      const missing = generatorsOf(checks).filter((each) => !runs.has(each));
      expect(missing, `add these to the dependsOn of ${task}`).toEqual([]);
    },
  );
});
