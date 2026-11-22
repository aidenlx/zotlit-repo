import type { CiCheck, LandGitHub, RecordPullRequest } from "#land";
import { $ } from "zx";

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
      const { check_runs: runs } = JSON.parse(
        await run([
          "api",
          `repos/${repo}/commits/${commit}/check-runs?check_name=${encodeURIComponent(name)}&filter=all&per_page=100`,
        ]),
      ) as { check_runs: GitHubCheckRun[] };
      if (runs.length === 0) return undefined;
      const { workflow_runs: workflows } = JSON.parse(
        await run([
          "api",
          `repos/${repo}/actions/runs?head_sha=${commit}&event=pull_request&per_page=100`,
        ]),
      ) as { workflow_runs: GitHubWorkflowRun[] };
      const record = new Set(
        workflows
          .filter(
            (workflow) =>
              workflow.head_branch === branch &&
              sameRepository(workflow.head_repository?.full_name ?? "", repo),
          )
          .map((workflow) => workflow.check_suite_id),
      );
      const latest = runs
        .filter((each) => record.has(each.check_suite.id))
        .toSorted((a, b) => b.id - a.id)[0];
      if (!latest) return undefined;
      const check: CiCheck = {
        id: latest.id,
        status: latest.status,
        conclusion: latest.conclusion,
        url: latest.html_url,
        ...(latest.started_at ? { startedAt: latest.started_at } : {}),
        ...(latest.completed_at ? { completedAt: latest.completed_at } : {}),
      };
      if (latest.status !== "completed") return check;
      const job = JSON.parse(
        await run(["api", `repos/${repo}/actions/jobs/${latest.id}`]),
      ) as { created_at: string };
      return { ...check, queuedAt: job.created_at };
    },
  };
}

function sameRepository(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

interface GitHubPullRequest extends RecordPullRequest {
  isCrossRepository: boolean;
}

interface GitHubWorkflowRun {
  head_branch: string | null;
  head_repository: { full_name: string } | null;
  check_suite_id: number;
}

interface GitHubCheckRun {
  id: number;
  status: CiCheck["status"];
  conclusion: string | null;
  html_url: string;
  started_at: string | null;
  completed_at: string | null;
  check_suite: { id: number };
}
