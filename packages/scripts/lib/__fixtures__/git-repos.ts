// Real Git repositories in a temporary folder for the land and push tests: a
// bare `origin` whose default branch is `main`, and clones of it. Git reads
// only the test's own global config, so the developer's hooks, signing, and
// identity stay out, and a test that runs inside a Git hook or a land sees no
// outer repository or Land Turn.

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Variables the tests replace, restored by `dispose`. */
const ISOLATED = [
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "ZOTLIT_DESKTOP_DIR",
  "ZOTLIT_LAND_TURN",
];

/** The new text of a file, and the message of its commit. */
interface Change {
  text: string;
  /** @default `change <file>` */
  message?: string;
}

export interface GitRepos {
  /** The temporary folder; the Land Queue state lives in `state/` in it. */
  root: string;
  /** The bare `origin`. */
  remote: string;
  /** A new clone of `origin`, checked out at `main`. */
  clone: (name: string) => Promise<string>;
  /** Commit `file` with `text` in `cwd`; returns the new commit. */
  commit: (cwd: string, file: string, change: Change) => Promise<string>;
  dispose: () => Promise<void>;
}

/** Stdout of `git ...args` in `cwd`, trimmed. */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run("git", args, { cwd })).stdout.trim();
}

export async function makeGitRepos(): Promise<GitRepos> {
  const root = await mkdtemp(join(tmpdir(), "land-"));
  const saved = Object.fromEntries(ISOLATED.map((key) => [key, process.env[key]]));
  for (const key of ISOLATED) delete process.env[key];
  const hooks = join(root, "no-hooks");
  await mkdir(hooks);
  // The clones ignore `.scratch/`, as the repository does.
  const excludes = join(root, "gitignore");
  await writeFile(excludes, ".scratch/\n");
  const config = join(root, "gitconfig");
  await writeFile(
    config,
    [
      "[user]",
      "  name = Test",
      "  email = test@example.com",
      "[init]",
      "  defaultBranch = main",
      "[commit]",
      "  gpgsign = false",
      "[core]",
      `  hooksPath = ${hooks}`,
      `  excludesFile = ${excludes}`,
      "[advice]",
      "  detachedHead = false",
      "",
    ].join("\n"),
  );
  process.env.GIT_CONFIG_GLOBAL = config;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.ZOTLIT_DESKTOP_DIR = join(root, "state");

  const remote = join(root, "origin.git");
  await run("git", ["init", "-q", "--bare", "-b", "main", remote]);
  const clone = async (name: string) => {
    const path = join(root, name);
    await run("git", ["clone", "-q", remote, path]);
    return path;
  };
  const commit = async (
    cwd: string,
    file: string,
    { text, message = `change ${file}` }: Change,
  ) => {
    await writeFile(join(cwd, file), text);
    await git(cwd, "add", file);
    await git(cwd, "commit", "-q", "-m", message);
    return await git(cwd, "rev-parse", "HEAD");
  };
  const seed = await clone("seed");
  await commit(seed, "README.md", { text: "seed\n", message: "seed" });
  await git(seed, "push", "-q", "origin", "HEAD:refs/heads/main");

  return {
    root,
    remote,
    clone,
    commit,
    dispose: async () => {
      for (const key of ISOLATED) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}
