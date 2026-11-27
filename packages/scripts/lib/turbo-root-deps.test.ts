import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { getWorkspaceRoot } from "./package-roots.ts";

const root = await getWorkspaceRoot(import.meta.dirname);

interface Plan {
  globalCacheInputs: { hashOfInternalDependencies: string };
  tasks: { taskId: string; command: string; inputs: Record<string, string> }[];
}

function plan(tasks: readonly string[]): Plan {
  return JSON.parse(
    execFileSync(
      "pnpm",
      ["exec", "turbo", "run", ...tasks, "--dry=json", "--cache=local:"],
      { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    ),
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

  it("the @zotlit/scripts tests hash the Companion files its publish tests run", () => {
    const task = plan(["@zotlit/scripts#test"]).tasks.find(
      ({ taskId }) => taskId === "@zotlit/scripts#test",
    );
    const companion = [
      "build-update-json.ts",
      "release-constants.ts",
      "release-host-notes.eta",
    ].map((file) => `../../apps/zotero/scripts/${file}`);
    expect(
      companion.filter((path) => !(path in task!.inputs)),
      "add these to the test inputs in packages/scripts/turbo.json",
    ).toEqual([]);
  });
});

const SCRIPTS = "packages/scripts";
const TRANSIT = "@zotlit/scripts#transit";

function git(
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
  input?: string,
): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
    input,
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function transitInputs(): Set<string> {
  const task = plan([TRANSIT]).tasks.find(({ taskId }) => taskId === TRANSIT);
  return new Set(Object.keys(task!.inputs));
}

const PATH_REFERENCE = /packages\/scripts\/((?:lib|scripts)\/[\w./-]*\w)/g;
const IMPORT = /(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']/g;

function trackedUnder(path: string): string[] {
  return git(["ls-files", "--", path]).split("\n").filter(Boolean);
}

function consumerSurface(): Set<string> {
  const manifest = JSON.parse(
    readFileSync(join(root, SCRIPTS, "package.json"), "utf8"),
  ) as { imports: Record<string, string>; exports: Record<string, string> };
  const alias = (specifier: string): string | undefined => {
    for (const [key, target] of Object.entries(manifest.imports)) {
      if (key === specifier) return target;
      if (key.endsWith("*") && specifier.startsWith(key.slice(0, -1))) {
        return target.replace("*", specifier.slice(key.length - 1));
      }
    }
    return undefined;
  };
  const surface = new Set<string>();
  const pending: string[] = [];
  const add = (path: string): void => {
    const file = relative(join(root, SCRIPTS), resolve(root, SCRIPTS, path));
    for (const each of trackedUnder(join(SCRIPTS, file))) {
      const inner = relative(SCRIPTS, each);
      if (!surface.has(inner)) {
        surface.add(inner);
        pending.push(inner);
      }
    }
  };
  const outside = git([
    "grep",
    "-h",
    "-o",
    "-E",
    "packages/scripts/(lib|scripts)/[A-Za-z0-9_./-]+",
    "--",
    "apps",
    "packages",
    "skills",
    `:!${SCRIPTS}`,
    ":!packages/config/*-baseline.json",
    ":!*.md",
    ":!*.mdx",
  ]);
  for (const [, path] of outside.matchAll(PATH_REFERENCE)) add(path!);
  for (const target of Object.values(manifest.exports)) add(target);
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (!/\.(?:ts|mjs|js)$/.test(file)) continue;
    const text = readFileSync(join(root, SCRIPTS, file), "utf8");
    for (const [, path] of text.matchAll(PATH_REFERENCE)) add(path!);
    for (const [, specifier] of text.matchAll(IMPORT)) {
      const target = specifier!.startsWith(".")
        ? join(dirname(file), specifier!)
        : specifier!.startsWith("#")
          ? alias(specifier!)
          : specifier!.startsWith("@zotlit/scripts/")
            ? manifest.exports[
                `./${specifier!.slice("@zotlit/scripts/".length)}`
              ]
            : undefined;
      if (target && existsSync(join(root, SCRIPTS, target))) add(target);
    }
  }
  return surface;
}

function commitWith(path?: string): string {
  const index = mkdtempSync(join(tmpdir(), "turbo-affected-"));
  const env = {
    GIT_INDEX_FILE: join(index, "index"),
    GIT_AUTHOR_NAME: "probe",
    GIT_AUTHOR_EMAIL: "probe@example.invalid",
    GIT_COMMITTER_NAME: "probe",
    GIT_COMMITTER_EMAIL: "probe@example.invalid",
  };
  try {
    git(["read-tree", "HEAD"], env);
    if (path) {
      const blob = git(
        ["hash-object", "-w", "--stdin"],
        env,
        `${git(["show", `HEAD:${path}`])}\n// probe\n`,
      );
      git(["update-index", "--cacheinfo", `100644,${blob},${path}`], env);
    }
    const tree = git(["write-tree"], env);
    return git(["commit-tree", tree, "-p", "HEAD", "-m", "probe"], env);
  } finally {
    rmSync(index, { recursive: true, force: true });
  }
}

function affectedTests(head: string): Set<string> {
  const run = JSON.parse(
    execFileSync(
      "pnpm",
      [
        "exec",
        "turbo",
        "run",
        "test",
        "--affected",
        "--dry=json",
        "--cache=local:",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, TURBO_SCM_BASE: "HEAD", TURBO_SCM_HEAD: head },
        maxBuffer: 256 * 1024 * 1024,
      },
    ),
  ) as Plan;
  return new Set(
    run.tasks
      .filter(
        ({ taskId, command }) =>
          command !== "<NONEXISTENT>" && taskId.endsWith("#test"),
      )
      .map(({ taskId }) => taskId),
  );
}

describe("the @zotlit/scripts transit inputs", () => {
  it("hold every file that another workspace imports or runs", () => {
    const inputs = transitInputs();
    expect(
      [...consumerSurface()].filter((file) => !inputs.has(file)).sort(),
      "remove these from the transit exclusions in packages/scripts/turbo.json",
    ).toEqual([]);
  });

  it("leave out the scripts that no other workspace runs", () => {
    const surface = consumerSurface();
    expect(
      [...transitInputs()]
        .filter((file) => file.startsWith("scripts/") && !surface.has(file))
        .sort(),
      "list only the scripts other workspaces run in the transit inputs of packages/scripts/turbo.json",
    ).toEqual([]);
  });

  it("a change to an unimported script leaves the tests of other packages out of --affected", () => {
    const dirty = affectedTests(commitWith());
    const changed = affectedTests(
      commitWith(`${SCRIPTS}/scripts/check-agent-guides.ts`),
    );
    expect(
      [...changed]
        .filter((task) => !dirty.has(task) && task !== "@zotlit/scripts#test")
        .sort(),
    ).toEqual([]);
    expect(changed).toContain("@zotlit/scripts#test");
  });

  it("a change to the Electron test launcher keeps the tests that import it in --affected", () => {
    const changed = affectedTests(
      commitWith(`${SCRIPTS}/lib/electron-renderer.ts`),
    );
    expect([...changed]).toEqual(
      expect.arrayContaining([
        "@zotlit/annotations#test",
        "@zotlit/pdf-reader#test",
        "@zotlit/resources#test",
      ]),
    );
  });
});
