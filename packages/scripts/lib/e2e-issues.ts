import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { LandE2eIssue, LandE2eIssues } from "./land-e2e.ts";

const execFileAsync = promisify(execFile);

export function githubE2eIssues(directory: string): LandE2eIssues {
  const gh = async (...args: string[]) =>
    (await execFileAsync("gh", args, { cwd: directory })).stdout.trim();
  const bodyFile = async (body: string) => {
    const path = join(directory, "issue-body.md");
    await writeFile(path, body);
    return path;
  };

  return {
    listOpen: async (repository, title) =>
      JSON.parse(
        await gh(
          "issue",
          "list",
          "--repo",
          repository,
          "--state",
          "open",
          "--search",
          `"${title}" in:title`,
          "--json",
          "number,title,url",
          "--limit",
          "100",
        ),
      ) as LandE2eIssue[],
    create: async (repository, { title, body, label }) =>
      gh(
        "issue",
        "create",
        "--repo",
        repository,
        "--label",
        label,
        "--title",
        title,
        "--body-file",
        await bodyFile(body),
      ),
    comment: async (repository, number, body) => {
      await gh(
        "issue",
        "comment",
        String(number),
        "--repo",
        repository,
        "--body-file",
        await bodyFile(body),
      );
    },
  };
}
