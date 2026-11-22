// The GitHub client of a land (`LandGitHub` in lib/land.ts) through the `gh`
// CLI, with the credential of its login. The land tests use a fake of it at
// the same seam.

import type { CiCheck, LandGitHub, RecordPullRequest } from "#land";
import { $ } from "zx";

/** The record PRs of `repo` (`owner/name`). */
export function ghLandGitHub(repo: string): LandGitHub {
  const gh = $({ quiet: true, nothrow: true });
  /** Stdout of `gh ...args`; throws with gh's stderr on a non-zero exit. */
  const run = async (args: string[], input?: string): Promise<string> => {
    const result = await (input === undefined ? gh : gh({ input }))`gh ${args}`;
    if (result.exitCode !== 0) {
      throw new Error(
        `gh ${args.slice(0, 2).join(" ")} exited ${result.exitCode}: ${result.stderr.trim()}`,
      );
    }
    return result.stdout.trim();
  };
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
          "number,url",
          "--limit",
          "1",
        ]),
      ) as RecordPullRequest[];
      return listed[0];
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
    async readCheck({ commit, name }) {
      const { check_runs: runs } = JSON.parse(
        await run([
          "api",
          `repos/${repo}/commits/${commit}/check-runs?check_name=${encodeURIComponent(name)}&filter=latest`,
        ]),
      ) as { check_runs: GitHubCheckRun[] };
      const latest = runs.toSorted((a, b) => b.id - a.id)[0];
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

/** The fields of a GitHub check run that the land reads. */
interface GitHubCheckRun {
  id: number;
  status: CiCheck["status"];
  conclusion: string | null;
  html_url: string;
  started_at: string | null;
  completed_at: string | null;
}
