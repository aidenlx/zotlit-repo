import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  checkGenerated,
  GENERATED_ARTIFACTS,
  UNGATED_GENERATORS,
} from "./generated-artifacts.ts";
import { getWorkspaceRoot } from "./package-roots.ts";

const root = await getWorkspaceRoot(import.meta.dirname);

function workspaceGenerators(): string[] {
  const manifests = ["apps", "packages"]
    .flatMap((group) =>
      readdirSync(join(root, group)).map((name) =>
        join(root, group, name, "package.json"),
      ),
    )
    .concat(join(root, "video", "package.json"))
    .filter((path) => existsSync(path));
  return manifests.flatMap((path) => {
    const manifest = JSON.parse(readFileSync(path, "utf8")) as {
      readonly name: string;
      readonly scripts?: Readonly<Record<string, string>>;
    };
    return Object.keys(manifest.scripts ?? {})
      .filter((script) => script.startsWith("generate:"))
      .map((script) => `${manifest.name}#${script}`);
  });
}

describe("the generator registry", () => {
  it("gates every generate script of the workspace, or names why it is not gated", () => {
    const gated = new Set(
      GENERATED_ARTIFACTS.flat().map((artifact) => artifact.task),
    );
    expect(
      workspaceGenerators().filter(
        (task) => !gated.has(task) && !Object.hasOwn(UNGATED_GENERATORS, task),
      ),
    ).toEqual([]);
  });
});

function runner(changes: Record<string, string>) {
  const tasks: string[][] = [];
  const compared: string[] = [];
  return {
    tasks,
    compared,
    regenerate: async (names: readonly string[]) => {
      tasks.push([...names]);
    },
    status: async (paths: readonly string[]) => {
      compared.push(...paths);
      return paths
        .filter((path) => changes[path])
        .map((path) => ` M ${path}`)
        .join("\n");
    },
  };
}

describe("checkGenerated", () => {
  const GUIDE = "packages/zotero-compat/AGENTS.md";
  const TABLE = "packages/zotero-reads/src/worker/web-api-machine.table.md";

  it("regenerates and compares every registered output on a code change, stage by stage", async () => {
    const run = runner({});
    await checkGenerated("all", run);
    expect(run.tasks).toEqual(
      GENERATED_ARTIFACTS.map((stage) =>
        stage.map((artifact) => artifact.task),
      ),
    );
    expect(run.compared).toEqual(
      GENERATED_ARTIFACTS.flat().flatMap((artifact) => artifact.paths),
    );
    expect(run.compared).toContain(TABLE);
  });

  it("fails a code change whose generated table differs from its source", async () => {
    const run = runner({ [TABLE]: "regenerated" });
    await expect(checkGenerated("all", run)).rejects.toThrow(TABLE);
  });

  it("fails a guide-only change whose generated block differs from its source", async () => {
    const run = runner({ [GUIDE]: "regenerated" });
    await expect(checkGenerated([GUIDE], run)).rejects.toThrow(GUIDE);
    expect(run.tasks).toEqual([
      ["@zotlit/zotero-compat#generate:known-differences"],
    ]);
  });

  it("passes a guide-only change outside the generated block", async () => {
    const run = runner({});
    await expect(checkGenerated([GUIDE], run)).resolves.toBeUndefined();
    expect(run.tasks).toHaveLength(1);
  });

  it("runs no generator for a change to other agent docs", async () => {
    const run = runner({});
    await checkGenerated(["AGENTS.md", "packages/db/AGENTS.md"], run);
    expect(run.tasks).toEqual([]);
  });
});
