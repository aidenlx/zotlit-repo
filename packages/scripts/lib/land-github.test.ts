import { describe, expect, it } from "vitest";

import { ghLandGitHub } from "./land-github.ts";
import type { GhRun } from "./land-github.ts";

// The gh client against a fake `gh`: each test gives the JSON that GitHub
// returns for one call, keyed by the call's first arguments. The shapes are
// trimmed from real responses of aidenlx/zotlit-repo (2026-11-22).
const REPO = "aidenlx/zotlit-repo";

function fakeGh(replies: Record<string, unknown>): GhRun {
  return async (args) => {
    const key =
      args[0] === "api" ? `api ${args[1]}` : args.slice(0, 2).join(" ");
    const reply = Object.entries(replies).find(([prefix]) =>
      key.startsWith(prefix),
    );
    if (!reply) throw new Error(`no fake reply for gh ${args.join(" ")}`);
    return JSON.stringify(reply[1]);
  };
}

/** A `gh pr list` entry; a fork's PR names the fork as its head repository. */
const pull = (number: number, owner: string) => ({
  number,
  url: `https://github.com/${REPO}/pull/${number}`,
  headRepository: {
    id: "R_1",
    name: "zotlit-repo",
    nameWithOwner: `${owner}/zotlit-repo`,
  },
  headRepositoryOwner: { id: "U_1", login: owner },
  isCrossRepository: owner !== "aidenlx",
});

describe("findOpenPullRequest", () => {
  it("skips a fork's PR whose branch has the same name", async () => {
    const github = ghLandGitHub(
      REPO,
      fakeGh({ "pr list": [pull(7, "mallory"), pull(5, "aidenlx")] }),
    );

    expect(
      await github.findOpenPullRequest({ head: "feat/a", base: "main" }),
    ).toEqual({ number: 5, url: `https://github.com/${REPO}/pull/5` });
  });

  it("finds no PR when only a fork has one from that branch", async () => {
    const github = ghLandGitHub(
      REPO,
      fakeGh({ "pr list": [pull(7, "mallory")] }),
    );

    expect(
      await github.findOpenPullRequest({ head: "feat/a", base: "main" }),
    ).toBeUndefined();
  });
});

const SHA = "a".repeat(40);

/** A check run of check suite `suite`: one that passed, or one that runs. */
const run = (id: number, suite: number, passed: boolean) => ({
  id,
  name: "Record PR tests",
  status: passed ? "completed" : "in_progress",
  conclusion: passed ? "success" : null,
  html_url: `https://github.com/${REPO}/actions/runs/1/job/${id}`,
  started_at: "2026-11-22T10:00:20Z",
  completed_at: null,
  check_suite: { id: suite },
  app: { slug: "github-actions" },
});

/** The workflow run of check suite `suite`, for a PR from `repo`'s feat/a. */
const workflow = (suite: number, repo: string) => ({
  id: suite * 10,
  name: "Record PR",
  event: "pull_request",
  head_branch: "feat/a",
  check_suite_id: suite,
  head_repository: { full_name: repo },
});

describe("readCheck", () => {
  it("reads only the check of the record PR's branch in this repository", async () => {
    const github = ghLandGitHub(
      REPO,
      fakeGh({
        [`api repos/${REPO}/commits/${SHA}/check-runs`]: {
          // Suite 2 is another app's, with no workflow run.
          check_runs: [run(30, 3, true), run(20, 2, true), run(10, 1, false)],
        },
        [`api repos/${REPO}/actions/runs`]: {
          workflow_runs: [
            // A fork's PR on the same head, from a branch of the same name.
            workflow(3, "mallory/zotlit-repo"),
            workflow(1, REPO),
          ],
        },
      }),
    );

    expect(
      await github.readCheck({
        commit: SHA,
        name: "Record PR tests",
        branch: "feat/a",
      }),
    ).toMatchObject({ id: 10, status: "in_progress" });
  });

  it("shows no check when only a fork's PR posted one", async () => {
    const github = ghLandGitHub(
      REPO,
      fakeGh({
        [`api repos/${REPO}/commits/${SHA}/check-runs`]: {
          check_runs: [run(30, 3, true)],
        },
        [`api repos/${REPO}/actions/runs`]: {
          workflow_runs: [workflow(3, "mallory/zotlit-repo")],
        },
      }),
    );

    expect(
      await github.readCheck({
        commit: SHA,
        name: "Record PR tests",
        branch: "feat/a",
      }),
    ).toBeUndefined();
  });
});
