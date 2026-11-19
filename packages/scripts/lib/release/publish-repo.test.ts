import type { GitRepos } from "#git-repos";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prepareShellCommit, pushShellCommit } from "./publish-repo.ts";
import type { PublishRepoOptions } from "./publish-repo.ts";

import { git, makeGitRepos } from "#git-repos";

// The publish repository is a bare repository in a temporary folder whose
// main holds an old history, as aidenlx/zotlit does; each test writes a shell
// tree and commits it the way a release does.
const SLOW = 30_000;
const run = promisify(execFile);

let repos: GitRepos;
let publish: PublishRepoOptions;
/** A clone of the publish repository, for commits that are not releases. */
let maintainer: string;

beforeEach(async () => {
  repos = await makeGitRepos();
  const remote = join(repos.root, "publish.git");
  await run("git", ["init", "-q", "--bare", "-b", "main", remote]);
  maintainer = join(repos.root, "maintainer");
  await run("git", ["clone", "-q", remote, maintainer]);
  await git(maintainer, "switch", "-q", "-c", "main");
  await repos.commit(maintainer, "monorepo.txt", {
    text: "old history\n",
    message: "old monorepo",
  });
  await git(maintainer, "push", "-q", "origin", "main");
  publish = { gitDir: join(repos.root, "work.git"), remote };
});
afterEach(() => repos.dispose());

/** A shell tree for `version` in its own folder. */
async function shellTree(version: string): Promise<string> {
  const dir = join(repos.root, `shell-${version}-${Math.random()}`);
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "manifest.json"), `{"version":"${version}"}\n`);
  await writeFile(join(dir, "src/main.ts"), "export {};\n");
  await writeFile(join(dir, ".gitignore"), "node_modules/\nmain.js\n");
  // The build output stays out of the commit.
  await writeFile(join(dir, "main.js"), "built\n");
  return dir;
}

async function release(version: string, line: "beta" | "stable") {
  const shell = await prepareShellCommit({
    ...publish,
    shellDir: await shellTree(version),
    version,
    line,
    message: `release: ${version}\n`,
  });
  if (shell.state === "ready") await pushShellCommit(publish, shell);
  return shell;
}

const remoteRev = (rev: string) => git(publish.remote, "rev-parse", rev);

describe("the shell commit", () => {
  it(
    "puts the first beta on a beta branch on top of main, with its tag, and leaves main as it was",
    async () => {
      const main = await remoteRev("main");

      const shell = await release("2.3.0-beta.0", "beta");

      expect(shell).toMatchObject({
        state: "ready",
        branch: "beta",
        parents: [main],
      });
      expect(await remoteRev("beta")).toBe(shell.commit);
      expect(await remoteRev("2.3.0-beta.0^{commit}")).toBe(shell.commit);
      expect(await remoteRev("main")).toBe(main);
      expect(
        (
          await git(publish.remote, "ls-tree", "-r", "--name-only", "beta")
        ).split("\n"),
      ).toEqual([".gitignore", "manifest.json", "src/main.ts"]);
    },
    SLOW,
  );

  it(
    "finds a finished release on a second run and pushes nothing",
    async () => {
      const first = await release("2.3.0-beta.0", "beta");

      const second = await prepareShellCommit({
        ...publish,
        shellDir: await shellTree("2.3.0-beta.0"),
        version: "2.3.0-beta.0",
        line: "beta",
        message: "release: 2.3.0-beta.0\n",
      });

      expect(second).toMatchObject({ state: "released", commit: first.commit });
    },
    SLOW,
  );

  it(
    "stops when the version's tag names another tree, since a published version is not made again",
    async () => {
      await release("2.3.0-beta.0", "beta");
      const changed = await shellTree("2.3.0-beta.0");
      await writeFile(
        join(changed, "src/main.ts"),
        "export const changed = 1;\n",
      );

      await expect(
        prepareShellCommit({
          ...publish,
          shellDir: changed,
          version: "2.3.0-beta.0",
          line: "beta",
          message: "release\n",
        }),
      ).rejects.toThrow(/not the shell of this run/);
    },
    SLOW,
  );

  it(
    "reuses a branch tip with the same tree when an earlier push carried the commit and not the tag",
    async () => {
      const first = await prepareShellCommit({
        ...publish,
        shellDir: await shellTree("2.3.0-beta.0"),
        version: "2.3.0-beta.0",
        line: "beta",
        message: "release\n",
      });
      await pushShellCommit(publish, first, { tag: false });

      const second = await release("2.3.0-beta.0", "beta");

      expect(second).toMatchObject({ state: "ready", commit: first.commit });
      expect(await remoteRev("2.3.0-beta.0^{commit}")).toBe(first.commit);
    },
    SLOW,
  );

  it(
    "stacks the next beta on the beta branch alone while main has nothing beta lacks",
    async () => {
      const first = await release("2.3.0-beta.0", "beta");

      const second = await release("2.3.0-beta.1", "beta");

      expect(second.parents).toEqual([first.commit]);
      expect(await remoteRev("beta")).toBe(second.commit);
    },
    SLOW,
  );

  it(
    "puts a stable release on main, and gives the next beta main as a second parent",
    async () => {
      const beta = await release("2.3.0-beta.0", "beta");
      const mainBefore = await remoteRev("main");

      const stable = await release("2.3.0", "stable");
      const next = await release("2.4.0-beta.0", "beta");

      expect(stable).toMatchObject({ branch: "main", parents: [mainBefore] });
      expect(await remoteRev("main")).toBe(stable.commit);
      expect(next.parents).toEqual([beta.commit, stable.commit]);
      // beta still moves as a fast-forward, and it now has main's history.
      await git(
        publish.remote,
        "merge-base",
        "--is-ancestor",
        stable.commit,
        "beta",
      );
    },
    SLOW,
  );

  it(
    "moves neither the branch nor the tag when the branch push is refused",
    async () => {
      const shell = await prepareShellCommit({
        ...publish,
        shellDir: await shellTree("2.3.0"),
        version: "2.3.0",
        line: "stable",
        message: "release\n",
      });
      // main moves after the commit was made, so the push is no fast-forward.
      await repos.commit(maintainer, "later.txt", { text: "later\n" });
      await git(maintainer, "push", "-q", "origin", "main");

      await expect(pushShellCommit(publish, shell)).rejects.toThrow();

      expect(await git(publish.remote, "tag", "--list")).toBe("");
    },
    SLOW,
  );
});
