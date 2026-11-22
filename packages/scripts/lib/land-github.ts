import type { CiCheck, LandGitHub, RecordPullRequest } from "#land";
import { regex } from "arkregex";
import { basename } from "node:path";
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

export function ghLandGitHub(repo: string, run: GhRun = ghCli): LandGitHub {
  return {
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
          "number,url,isCrossRepository",
        ]),
      ) as GitHubPullRequest[];
      const own = listed.find((pull) => !pull.isCrossRepository);
      return own && { number: own.number, url: own.url };
    },
    async createPullRequest({ head, base, title, body }) {
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
        ...(longest?.started_at
          ? { queuedAt: longest.created_at, startedAt: longest.started_at }
          : {}),
        ...(gate.completed_at ? { completedAt: gate.completed_at } : {}),
      };
    },
  };
}

function sameRepository(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

interface GitHubPullRequest extends RecordPullRequest {
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
