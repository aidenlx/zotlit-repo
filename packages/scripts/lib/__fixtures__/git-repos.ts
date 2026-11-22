
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

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

interface Change {
  text: string;
  message?: string;
}

export interface GitRepos {
  root: string;
  remote: string;
  clone: (name: string) => Promise<string>;
  commit: (cwd: string, file: string, change: Change) => Promise<string>;
  dispose: () => Promise<void>;
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run("git", args, { cwd })).stdout.trim();
}

export async function makeGitRepos(): Promise<GitRepos> {
  const root = await mkdtemp(join(tmpdir(), "land-"));
  const saved = Object.fromEntries(ISOLATED.map((key) => [key, process.env[key]]));
  for (const key of ISOLATED) delete process.env[key];
  const hooks = join(root, "no-hooks");
  await mkdir(hooks);
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
