// The GitHub client of a land (`LandGitHub` in lib/land.ts) through the `gh`
// CLI, with the credential of its login. The land tests use a fake of it at
// the same seam; land-github.test.ts gives it a fake `gh`.

import type { CiCheck, LandGitHub, RecordPullRequest } from "#land";
import { $ } from "zx";

/** Stdout of `gh ...args`, with `input` on stdin; throws on a failed call. */
export type GhRun = (args: string[], input?: string) => Promise<string>;

/** The `gh` CLI; the error has gh's stderr on a non-zero exit. */
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

/** The record PRs of `repo` (`owner/name`). */
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
      // `--head` matches the branch name alone, also on a fork's PR; the
      // record PR's head is a branch of this repository.
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
      // Any workflow on the commit can name a job the same, also the
      // workflow of a fork's PR on that head. The check counts only when its
      // check suite is the workflow run of a PR from `branch` of this
      // repository. A check suite does not name its head repository; the
      // workflow run of the suite does.
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
      // A check run of an Actions job has the id of the job, whose
      // `created_at` is when it joined the queue for a runner.
      const job = JSON.parse(
        await run(["api", `repos/${repo}/actions/jobs/${latest.id}`]),
      ) as { created_at: string };
      return { ...check, queuedAt: job.created_at };
    },
  };
}

/** GitHub writes the name of a repository in any case. */
function sameRepository(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** The fields of a `gh pr list` entry that the land reads. */
interface GitHubPullRequest extends RecordPullRequest {
  /** Whether the head branch is in another repository, a fork. */
  isCrossRepository: boolean;
}

/** The fields of a GitHub Actions workflow run that the land reads. */
interface GitHubWorkflowRun {
  head_branch: string | null;
  head_repository: { full_name: string } | null;
  check_suite_id: number;
}

/** The fields of a GitHub check run that the land reads. */
interface GitHubCheckRun {
  id: number;
  status: CiCheck["status"];
  conclusion: string | null;
  html_url: string;
  started_at: string | null;
  completed_at: string | null;
  check_suite: { id: number };
}
