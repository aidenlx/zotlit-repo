// The GitHub client of a land (`LandGitHub` in lib/land.ts) through the `gh`
// CLI, with the credential of its login. The land tests use a fake of it at
// the same seam.

import type { LandGitHub, RecordPullRequest } from "#land";
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
    async openPullRequest({ head, base }) {
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
  };
}
