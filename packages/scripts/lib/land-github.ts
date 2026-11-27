import type { CiCheck, LandGitHub, OpenRecordPullRequest } from "#land";
import { regex } from "arkregex";
import { basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { $ } from "zx";

import { RECORD_PR_WORKFLOW } from "#land";

const GITHUB_REMOTE = regex(
  "github\\.com[:/](?<repository>[^/]+/[^/]+?)(?:\\.git)?/?$",
);

export function githubRepository(url: string): string | undefined {
  return GITHUB_REMOTE.exec(url.trim())?.groups.repository;
}

export type GhRun = (args: string[], input?: string) => Promise<string>;

const ghCli: GhRun = async (args, input) => {
  const gh = $({ quiet: true, nothrow: true });
  const result = await (input === undefined ? gh : gh({ input }))`gh ${args}`;
  if (result.exitCode !== 0) {
    throw new Error(
      `gh ${args.slice(0, 2).join(" ")} exited ${result.exitCode}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout.trim();
};

const LAND_POLL_MS = 10_000;
const LAND_RUN_UNSEEN_POLLS = 6;

const notFound = (error: unknown) =>
  error instanceof Error && error.message.includes("(HTTP 404)");

export function ghLandGitHub(
  repo: string,
  run: GhRun = ghCli,
  wait: (ms: number) => Promise<unknown> = delay,
): LandGitHub {
  return {
    async advanceMain({ number, head, base, skipCi }, progress) {
      const result = JSON.parse(
        await run(
          [
            "api",
            "--method",
            "POST",
            `repos/${repo}/actions/workflows/land.yml/dispatches`,
            "--input",
            "-",
          ],
          JSON.stringify({
            ref: "main",
            inputs: {
              pull: String(number),
              head,
              base,
              ...(skipCi ? { skip_ci: "true" } : {}),
            },
            return_run_details: true,
          }),
        ),
      ) as { workflow_run_id: number };
      if (!Number.isSafeInteger(result.workflow_run_id))
        throw new Error("GitHub did not return a landing run ID.");
      const url = `https://github.com/${repo}/actions/runs/${result.workflow_run_id}`;
      let unseen = 0;
      for (;;) {
        const reply = await run([
          "api",
          `repos/${repo}/actions/runs/${result.workflow_run_id}`,
        ]).catch((error: unknown) => {
          if (notFound(error) && unseen < LAND_RUN_UNSEEN_POLLS) return;
          throw error;
        });
        if (reply === undefined) {
          unseen += 1;
          progress(`Land workflow not visible yet: ${url}`);
          await wait(LAND_POLL_MS);
          continue;
        }
        const state = JSON.parse(reply) as {
          status: string;
          conclusion: string | null;
        };
        progress(`Land workflow ${state.status}: ${url}`);
        if (state.status === "completed") {
          if (state.conclusion !== "success")
            throw new Error(`Land workflow ${state.conclusion}: ${url}`);
          return;
        }
        await wait(LAND_POLL_MS);
      }
    },
    async findOpenPullRequest({ head, base }) {
      const listed = JSON.parse(
        await run([
          "pr",
          "list",
          "--repo",
          repo,
          "--head",
          head,
          "--base",
          base,
          "--state",
          "open",
          "--json",
          "number,url,title,body,isDraft,isCrossRepository",
        ]),
      ) as GitHubPullRequest[];
      const own = listed.find((pull) => !pull.isCrossRepository);
      return (
        own && {
          number: own.number,
          url: own.url,
          title: own.title,
          body: own.body,
          draft: own.isDraft,
        }
      );
    },
    async createPullRequest({ head, base, title, body, draft }) {
      const printed = await run(
        [
          "pr",
          "create",
          "--repo",
          repo,
          "--head",
          head,
          "--base",
          base,
          "--title",
          title,
          "--body-file",
          "-",
          ...(draft ? ["--draft"] : []),
        ],
        body,
      );
      const url = printed.split("\n").at(-1) ?? "";
      const number = Number(url.split("/").at(-1));
      if (!Number.isInteger(number)) {
        throw new Error(`gh pr create printed no PR URL: ${url}`);
      }
      return { number, url };
    },
    async editPullRequest(number, { title, body }) {
      await run(
        [
          "pr",
          "edit",
          String(number),
          "--repo",
          repo,
          "--title",
          title,
          "--body-file",
          "-",
        ],
        body,
      );
    },
    async setDraft(number, draft) {
      await run([
        "pr",
        "ready",
        String(number),
        "--repo",
        repo,
        ...(draft ? ["--undo"] : []),
      ]);
    },
    async pullRequestState(number) {
      const { state } = JSON.parse(
        await run([
          "pr",
          "view",
          String(number),
          "--repo",
          repo,
          "--json",
          "state",
        ]),
      ) as { state: "OPEN" | "CLOSED" | "MERGED" };
      return state;
    },
    async readCheck({ commit, name, branch }) {
      const { workflow_runs: workflows } = JSON.parse(
        await run([
          "api",
          `repos/${repo}/actions/workflows/${basename(RECORD_PR_WORKFLOW)}/runs?head_sha=${commit}&event=pull_request&per_page=100`,
        ]),
      ) as { workflow_runs: GitHubWorkflowRun[] };
      const workflow = workflows
        .filter(
          (each) =>
            each.head_branch === branch &&
            sameRepository(each.head_repository?.full_name ?? "", repo),
        )
        .toSorted((a, b) => b.id - a.id)[0];
      if (!workflow) return undefined;
      if (workflow.status !== "completed") {
        return {
          id: workflow.id,
          status: workflow.status,
          conclusion: null,
          url: workflow.html_url,
        };
      }
      const { jobs } = JSON.parse(
        await run([
          "api",
          `repos/${repo}/actions/runs/${workflow.id}/jobs?per_page=100`,
        ]),
      ) as { jobs: GitHubJob[] };
      const gate = jobs.find((job) => job.name === name);
      if (!gate) return undefined;
      const shards = jobs.filter((job) => job !== gate);
      const longest = shards
        .filter(({ started_at }) => started_at)
        .toSorted((a, b) => runnerWait(b) - runnerWait(a))[0];
      const failed =
        shards.find(({ conclusion }) => conclusion === "failure") ??
        shards.find(({ conclusion }) => conclusion !== "success");
      return {
        id: gate.id,
        status: gate.status,
        conclusion: gate.conclusion,
        url: (failed ?? gate).html_url,
        ...(failed ? { failedJobId: failed.id } : {}),
        ...(longest?.started_at
          ? { queuedAt: longest.created_at, startedAt: longest.started_at }
          : {}),
        ...(gate.completed_at ? { completedAt: gate.completed_at } : {}),
      };
    },
    async readJobLog(jobId) {
      return await run([
        "api",
        "--allow-escape-sequences",
        `repos/${repo}/actions/jobs/${jobId}/logs`,
      ]);
    },
  };
}

function sameRepository(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

interface GitHubPullRequest extends Omit<OpenRecordPullRequest, "draft"> {
  isDraft: boolean;
  isCrossRepository: boolean;
}

function runnerWait({ created_at, started_at }: GitHubJob): number {
  return started_at
    ? Temporal.Instant.from(started_at).epochMilliseconds -
        Temporal.Instant.from(created_at).epochMilliseconds
    : 0;
}

interface GitHubJob {
  id: number;
  name: string;
  status: CiCheck["status"];
  conclusion: string | null;
  html_url: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface GitHubWorkflowRun {
  id: number;
  status: CiCheck["status"];
  html_url: string;
  head_branch: string | null;
  head_repository: { full_name: string } | null;
}
