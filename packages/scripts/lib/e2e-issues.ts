import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { E2eIssue, E2eIssues } from "./e2e-report.ts";

const execFileAsync = promisify(execFile);

export type Gh = (args: string[], cwd: string) => Promise<string>;

const ghCli: Gh = async (args, cwd) =>
  (await execFileAsync("gh", args, { cwd, maxBuffer: 64 * 1024 * 1024 }))
    .stdout;

export function githubE2eIssues(directory: string, run: Gh = ghCli): E2eIssues {
  const gh = async (...args: string[]) => (await run(args, directory)).trim();
  const bodyFile = async (body: string) => {
    const path = join(directory, "issue-body.md");
    await writeFile(path, body);
    return path;
  };

  return {
    listOpen: async (repository) =>
      JSON.parse(
        await gh(
          "issue",
          "list",
          "--repo",
          repository,
          "--state",
          "open",
          "--json",
          "number,title,url,body",
          "--limit",
          "1000",
        ),
      ) as E2eIssue[],
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
