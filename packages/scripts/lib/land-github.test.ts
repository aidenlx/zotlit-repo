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
    branch = "feat/a",
  }: { repo?: string; status?: string; branch?: string } = {},
) => ({
  id,
  status,
  html_url: `https://github.com/${REPO}/actions/runs/${id}`,
  head_branch: branch,
  head_repository: { full_name: repo },
});

const job = (
  id: number,
  name: string,
  {
    conclusion,
    created,
    started,
    completed,
  }: {
    conclusion: string;
    created: string;
    started: string;
    completed: string;
  },
) => ({
  id,
  name,
  status: "completed",
  conclusion,
  html_url: `https://github.com/${REPO}/actions/runs/1/job/${id}`,
  created_at: `2026-11-22T10:${created}Z`,
  started_at: `2026-11-22T10:${started}Z`,
  completed_at: `2026-11-22T10:${completed}Z`,
});

const shard = (index: number, conclusion: string) =>
  job(index, `Record PR shard ${index}`, {
    conclusion,
    ...[
      { created: "00:00", started: "00:30", completed: "04:00" },
      { created: "00:01", started: "00:41", completed: "05:00" },
      { created: "00:20", started: "00:50", completed: "06:00" },
    ][index - 1]!,
  });

const gate = (conclusion: string) =>
  job(4, "Record PR tests", {
    conclusion,
    created: "06:01",
    started: "09:00",
    completed: "09:10",
  });

async function readCheck(replies: Record<string, unknown>) {
  return ghLandGitHub(REPO, fakeGh(replies)).readCheck({
    commit: SHA,
    name: "Record PR tests",
    branch: "feat/a",
  });
}

const readJobs = (...jobs: ReturnType<typeof job>[]) =>
  readCheck({
    [RUNS]: { workflow_runs: [workflow(10)] },
    [`api repos/${REPO}/actions/runs/10/jobs`]: { jobs },
  });

describe("readCheck", () => {
  it("reads only the newest run of the record PR's branch in this repository", async () => {
    expect(
      await readCheck({
        [RUNS]: {
          workflow_runs: [
            workflow(30, { repo: "mallory/zotlit-repo" }),
            workflow(20, { branch: "feat/b" }),
            workflow(9, { status: "queued" }),
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
        [`api repos/${REPO}/actions/runs/10/jobs`]: { jobs: [gate("failure")] },
      }),
    ).toEqual({
      id: 10,
      status: "queued",
      conclusion: null,
      url: `https://github.com/${REPO}/actions/runs/10`,
    });
  });

  it("names the failed shard before a cancelled one, and the longest wait of a shard for a runner", async () => {
    expect(
      await readJobs(
        gate("failure"),
        shard(1, "cancelled"),
        shard(2, "success"),
        shard(3, "failure"),
      ),
    ).toEqual({
      id: 4,
      status: "completed",
      conclusion: "failure",
      url: `https://github.com/${REPO}/actions/runs/1/job/3`,
      queuedAt: "2026-11-22T10:00:01Z",
      startedAt: "2026-11-22T10:00:41Z",
      completedAt: "2026-11-22T10:09:10Z",
    });
  });

  it("names the shard that ran past its time limit, which GitHub cancels", async () => {
    expect(
      await readJobs(
        shard(1, "success"),
        shard(2, "cancelled"),
        shard(3, "success"),
        gate("failure"),
      ),
    ).toMatchObject({
      conclusion: "failure",
      url: `https://github.com/${REPO}/actions/runs/1/job/2`,
    });
  });

  it("names the check's own log when every shard passed", async () => {
    expect(
      await readJobs(
        shard(1, "success"),
        shard(2, "success"),
        shard(3, "success"),
        gate("success"),
      ),
    ).toMatchObject({
      conclusion: "success",
      url: `https://github.com/${REPO}/actions/runs/1/job/4`,
    });
  });
});
