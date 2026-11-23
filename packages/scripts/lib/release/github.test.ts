import type { GitRepos } from "#git-repos";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { gitSourceTags } from "./github.ts";
import { pushSourceTag } from "./obsidian.ts";
import type { SourceTags } from "./obsidian.ts";

import { git, makeGitRepos } from "#git-repos";

describe("gitSourceTags", () => {
  const run = vi.fn(async () => {});
  let repos: GitRepos;
  let tags: SourceTags;
  let commit: string;
  let otherCommit: string;

  beforeAll(async () => {
    repos = await makeGitRepos();
    const cwd = await repos.clone("source");
    otherCommit = await git(cwd, "rev-parse", "HEAD");
    commit = await repos.commit(cwd, "README.md", { text: "release\n" });
    await git(cwd, "tag", "lightweight", commit);
    await git(cwd, "tag", "-a", "annotated", "-m", "release", commit);
    await git(cwd, "tag", "other-commit", otherCommit);
    await git(cwd, "push", "-q", repos.remote, "--tags");
    tags = gitSourceTags({
      cwd,
      remote: repos.remote,
      outward: { dryRun: true, commands: [], run },
    });
  });

  afterAll(() => repos?.dispose());

  it("returns undefined for an absent tag", async () => {
    expect(await tags.get("absent")).toBeUndefined();
  });

  it("returns the commit of a lightweight tag", async () => {
    expect(await tags.get("lightweight")).toBe(commit);
  });

  it("returns the commit of an annotated tag and accepts it on a retry", async () => {
    expect(await tags.get("annotated")).toBe(commit);
    await pushSourceTag({ tags, tag: "annotated", commit, say: () => {} });
    expect(run).not.toHaveBeenCalled();
  });

  it("returns the other commit and rejects a conflicting source tag", async () => {
    expect(await tags.get("other-commit")).toBe(otherCommit);
    await expect(
      pushSourceTag({ tags, tag: "other-commit", commit, say: () => {} }),
    ).rejects.toThrow(
      `other-commit on ${otherCommit.slice(0, 12)}, not on ${commit.slice(0, 12)}`,
    );
    expect(run).not.toHaveBeenCalled();
  });
});
