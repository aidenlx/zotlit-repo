// The shell commit of a release in the publish repository. The commit goes on
// top of the branch of its line, so the history of the publish repository,
// its tags and its releases stay as they are, and no push needs force:
//
//   stable:  main ── shell x.y.z                   (tag x.y.z)
//   beta:    beta ── shell x.y.z-beta.n            (tag x.y.z-beta.n)
//            the first beta, or a beta after a stable release that `beta`
//            lacks, also takes the tip of main as a parent
//
// A second run finds what the first one did: a tag that names the same tree
// is a finished release, and a branch tip with the same tree is reused.
import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "zx";

import { PUBLISH_BRANCH } from "./lines.ts";
import type { ReleaseLine } from "./lines.ts";

/** Who the shell commits name. A release is made by the release flow, not by a person. */
export const RELEASE_AUTHOR = {
  name: "github-actions[bot]",
  email: "41898282+github-actions[bot]@users.noreply.github.com",
} as const;

export interface ShellCommit {
  /** `released`: the tag exists and names this tree; nothing to push. */
  state: "released" | "ready";
  commit: string;
  branch: string;
  tag: string;
  parents: string[];
  /** The branch tip the commit goes on, before the push. */
  base: string;
  movesMain: boolean;
}

export interface PublishRepoOptions {
  /** A bare repository that holds what is fetched; made when missing. */
  gitDir: string;
  /** The publish repository: a URL, or a path for a local stand-in. */
  remote: string;
  /**
   * Git settings for the commands that reach the remote, such as an auth
   * header. They go through the environment (`GIT_CONFIG_COUNT`), so no
   * command line or log shows them.
   */
  remoteConfig?: Readonly<Record<string, string>>;
}

/** `GIT_CONFIG_*` variables that set `config` for one Git command. */
export function gitConfigEnv(
  config: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const entries = Object.entries(config);
  return Object.fromEntries([
    ["GIT_CONFIG_COUNT", String(entries.length)],
    ...entries.flatMap(([key, value], index) => [
      [`GIT_CONFIG_KEY_${index}`, key],
      [`GIT_CONFIG_VALUE_${index}`, value],
    ]),
  ]);
}

/** The header that authenticates Git over HTTPS to GitHub with a token. */
export function githubTokenConfig(token: string): Record<string, string> {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    "http.https://github.com/.extraheader": `AUTHORIZATION: basic ${basic}`,
  };
}

function gitIn(options: PublishRepoOptions, env: NodeJS.ProcessEnv = {}) {
  const sh = $({
    quiet: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
  });
  const remoteSh = sh({
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      ...env,
      ...gitConfigEnv(options.remoteConfig),
    },
  });
  return {
    /** A local command; stdout, trimmed. */
    local: async (...args: string[]) =>
      (await sh`git --git-dir ${options.gitDir} ${args}`).stdout.trim(),
    /** A command that reaches the remote. */
    remote: async (...args: string[]) =>
      (await remoteSh`git --git-dir ${options.gitDir} ${args}`).stdout.trim(),
    test: async (...args: string[]) =>
      (await sh({ nothrow: true })`git --git-dir ${options.gitDir} ${args}`)
        .exitCode === 0,
  };
}

/** The `refs/...` → sha map the remote lists for its heads and tags. */
async function remoteRefs(
  options: PublishRepoOptions,
): Promise<Map<string, string>> {
  const git = gitIn(options);
  const listed = await git.remote(
    "ls-remote",
    "--heads",
    "--tags",
    options.remote,
  );
  const refs = new Map<string, string>();
  for (const line of listed.split("\n").filter(Boolean)) {
    const [sha = "", ref = ""] = line.split("\t");
    if (!ref.endsWith("^{}")) refs.set(ref, sha);
  }
  return refs;
}

/**
 * Fetches the publish repository's state and writes the shell commit of
 * `version` from the files in `shellDir`, without pushing it.
 */
export async function prepareShellCommit(
  options: PublishRepoOptions & {
    shellDir: string;
    version: string;
    line: ReleaseLine;
    message: string;
  },
): Promise<ShellCommit> {
  const { gitDir, remote, shellDir, version, line, message } = options;
  const git = gitIn(options);
  try {
    await access(gitDir);
  } catch {
    await $({ quiet: true })`git init -q --bare ${gitDir}`;
  }
  const refs = await remoteRefs(options);
  const branch = PUBLISH_BRANCH[line];
  const tag = version;
  // Commits and trees only: the shell commit needs its parents and their
  // trees, not the files of the old history.
  const fetch = (from: string, to: string) =>
    git.remote(
      "fetch",
      "-q",
      "--no-tags",
      "--filter=blob:none",
      remote,
      `+${from}:${to}`,
    );
  if (!refs.has("refs/heads/main")) {
    throw new Error(`${remote} has no main branch to put the shell on.`);
  }
  await fetch("refs/heads/main", "refs/remotes/publish/main");
  const hasBeta = refs.has("refs/heads/beta");
  if (hasBeta) await fetch("refs/heads/beta", "refs/remotes/publish/beta");

  const tree = await writeTree(options, shellDir);
  const treeOf = (rev: string) => git.local("rev-parse", `${rev}^{tree}`);

  if (refs.has(`refs/tags/${tag}`)) {
    await fetch(`refs/tags/${tag}`, `refs/tags/${tag}`);
    const tagged = await git.local("rev-parse", `refs/tags/${tag}^{commit}`);
    if ((await treeOf(tagged)) !== tree) {
      throw new Error(
        `${remote} has the tag ${tag} on ${tagged.slice(0, 12)}, whose tree is not the shell of this run. A published version is not made again: release a new version.`,
      );
    }
    return {
      state: "released",
      commit: tagged,
      branch,
      tag,
      parents: [],
      base: tagged,
      movesMain: false,
    };
  }

  const main = await git.local("rev-parse", "refs/remotes/publish/main");
  let parents: string[];
  if (line === "stable" || !hasBeta) {
    parents = [main];
  } else {
    const beta = await git.local("rev-parse", "refs/remotes/publish/beta");
    parents = (await git.test("merge-base", "--is-ancestor", main, beta))
      ? [beta]
      : [beta, main];
  }
  const base = parents[0]!;
  const movesMain =
    line !== "stable" &&
    (await git.local("ls-tree", "refs/remotes/publish/main")) === "";
  if (parents.length === 1 && (await treeOf(base)) === tree) {
    // A run before this one pushed the commit, and not the tag.
    return {
      state: "ready",
      commit: base,
      branch,
      tag,
      parents,
      base,
      movesMain,
    };
  }
  const commit = (
    await $({
      quiet: true,
      input: message,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: RELEASE_AUTHOR.name,
        GIT_AUTHOR_EMAIL: RELEASE_AUTHOR.email,
        GIT_COMMITTER_NAME: RELEASE_AUTHOR.name,
        GIT_COMMITTER_EMAIL: RELEASE_AUTHOR.email,
      },
    })`git --git-dir ${gitDir} commit-tree ${tree} ${parents.flatMap((parent) => ["-p", parent])}`
  ).stdout.trim();
  return { state: "ready", commit, branch, tag, parents, base, movesMain };
}

/** The tree of the files in `dir`, as Git would commit them; honors its `.gitignore`. */
async function writeTree(
  options: PublishRepoOptions,
  dir: string,
): Promise<string> {
  const index = join(options.gitDir, "shell-index");
  await rm(index, { force: true });
  const git = gitIn(options, { GIT_INDEX_FILE: index });
  await git.local("--work-tree", dir, "add", "--all", ".");
  return git.local("write-tree");
}

/**
 * The refspecs of the release push: the commit onto its branch, onto main
 * when main has no files, and the tag, in one atomic push, so
 * the branches and the tag move together or not at all.
 */
export function releaseRefspecs(
  shell: ShellCommit,
  { tag = true }: { tag?: boolean } = {},
): string[] {
  return [
    `${shell.commit}:refs/heads/${shell.branch}`,
    ...(shell.movesMain ? [`${shell.commit}:refs/heads/main`] : []),
    ...(tag ? [`${shell.commit}:refs/tags/${shell.tag}`] : []),
  ];
}

/** Pushes the shell commit (and its tag) to the publish repository. */
export async function pushShellCommit(
  options: PublishRepoOptions,
  shell: ShellCommit,
  { tag = true }: { tag?: boolean } = {},
): Promise<void> {
  await gitIn(options).remote(
    "push",
    "--atomic",
    "--porcelain",
    options.remote,
    ...releaseRefspecs(shell, { tag }),
  );
}
