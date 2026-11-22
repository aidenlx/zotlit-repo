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
          "number,url,headRepository,headRepositoryOwner",
        ]),
      ) as GitHubPullRequest[];
      // `--head` matches the branch name alone, also on a fork's PR; the
      // record PR's head is a branch of this repository.
      const own = listed.find((pull) =>
        sameRepository(
          `${pull.headRepositoryOwner.login}/${pull.headRepository.name}`,
          repo,
        ),
      );
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
          `repos/${repo}/commits/${commit}/check-runs?check_name=${encodeURIComponent(name)}&filter=latest&per_page=100`,
        ]),
      ) as { check_runs: GitHubCheckRun[] };
      if (runs.length === 0) return undefined;
      // Any workflow on the commit can name a job the same, also the
      // workflow of a fork's PR on that head. The check counts only when its
      // check suite is an Actions run of `branch` in this repository.
      const { check_suites: suites } = JSON.parse(
        await run([
          "api",
          `repos/${repo}/commits/${commit}/check-suites?per_page=100`,
        ]),
      ) as { check_suites: GitHubCheckSuite[] };
      const record = new Set(
        suites
          .filter(
            (suite) =>
              suite.app?.slug === "github-actions" &&
              suite.head_branch === branch &&
              sameRepository(suite.head_repository?.full_name ?? "", repo),
          )
          .map((suite) => suite.id),
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
  headRepository: { name: string };
  headRepositoryOwner: { login: string };
}

/** The fields of a GitHub check suite that the land reads. */
interface GitHubCheckSuite {
  id: number;
  head_branch: string | null;
  head_repository: { full_name: string } | null;
  app: { slug: string } | null;
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
