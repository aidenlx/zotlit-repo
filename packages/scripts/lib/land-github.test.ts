import { describe, expect, it } from "vitest";

import { ghLandGitHub } from "./land-github.ts";
import type { GhRun } from "./land-github.ts";

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

const RUNS = `api repos/${REPO}/actions/workflows/record-pr.yml/runs?head_sha=${SHA}`;

const workflow = (
  id: number,
  {
    repo = REPO,
    status = "completed",
  }: { repo?: string; status?: string } = {},
) => ({
  id,
  status,
  html_url: `https://github.com/${REPO}/actions/runs/${id}`,
  head_branch: "feat/a",
  head_repository: { full_name: repo },
});

const job = (
  id: number,
  name: string,
  {
    conclusion,
    startedAt = "2026-11-22T10:00:05Z",
  }: { conclusion: string; startedAt?: string },
) => ({
  id,
  name,
  status: "completed",
  conclusion,
  html_url: `https://github.com/${REPO}/actions/runs/1/job/${id}`,
  created_at: "2026-11-22T10:00:00Z",
  started_at: startedAt,
  completed_at: "2026-11-22T10:04:00Z",
});

async function readCheck(replies: Record<string, unknown>) {
  return ghLandGitHub(REPO, fakeGh(replies)).readCheck({
    commit: SHA,
    name: "Record PR tests",
    branch: "feat/a",
  });
}

describe("readCheck", () => {
  it("reads only the run of the record PR's branch in this repository", async () => {
    expect(
      await readCheck({
        [RUNS]: {
          workflow_runs: [
            workflow(30, { repo: "mallory/zotlit-repo" }),
            workflow(10, { status: "in_progress" }),
          ],
        },
      }),
    ).toMatchObject({ id: 10, status: "in_progress" });
  });

  it("shows no check when only a fork's PR ran one", async () => {
    expect(
      await readCheck({
        [RUNS]: {
          workflow_runs: [workflow(30, { repo: "mallory/zotlit-repo" })],
        },
      }),
    ).toBeUndefined();
  });

  it("waits for a rerun, whose earlier attempt failed", async () => {
    expect(
      await readCheck({
        [RUNS]: { workflow_runs: [workflow(10, { status: "queued" })] },
        [`api repos/${REPO}/actions/runs/10/jobs`]: {
          jobs: [job(4, "Record PR tests", { conclusion: "failure" })],
        },
      }),
    ).toEqual({
      id: 10,
      status: "queued",
      conclusion: null,
      url: `https://github.com/${REPO}/actions/runs/10`,
    });
  });

  it("names the failed shard, not the one that its failure cancelled, and the longest wait for a runner", async () => {
    expect(
      await readCheck({
        [RUNS]: { workflow_runs: [workflow(10)] },
        [`api repos/${REPO}/actions/runs/10/jobs`]: {
          jobs: [
            job(1, "Record PR shard 1", { conclusion: "cancelled" }),
            job(2, "Record PR shard 2", {
              conclusion: "failure",
              startedAt: "2026-11-22T10:00:40Z",
            }),
            job(3, "Record PR shard 3", { conclusion: "success" }),
            job(4, "Record PR tests", { conclusion: "failure" }),
          ],
        },
      }),
    ).toEqual({
      id: 4,
      status: "completed",
      conclusion: "failure",
      url: `https://github.com/${REPO}/actions/runs/1/job/2`,
      queuedAt: "2026-11-22T10:00:00Z",
      startedAt: "2026-11-22T10:00:40Z",
      completedAt: "2026-11-22T10:04:00Z",
    });
  });

  it("names the gate's own log when it passed", async () => {
    expect(
      await readCheck({
        [RUNS]: { workflow_runs: [workflow(10)] },
        [`api repos/${REPO}/actions/runs/10/jobs`]: {
          jobs: [
            job(1, "Record PR shard 1", { conclusion: "success" }),
            job(4, "Record PR tests", { conclusion: "success" }),
          ],
        },
      }),
    ).toMatchObject({
      conclusion: "success",
      url: `https://github.com/${REPO}/actions/runs/1/job/4`,
    });
  });
});
