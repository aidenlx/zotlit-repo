import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

import { git, makeGitRepos } from "./__fixtures__/git-repos.ts";

const run = promisify(execFile);
const valid = {
  message: "A human contribution",
  conclusion: "success",
  state: "open",
  error: "",
};
it.each([
  { ...valid, label: "passes" },
  {
    ...valid,
    label: "rejects an earlier attributed commit",
    message: "Made with Cursor",
    error: "Remove AI attribution",
  },
  {
    ...valid,
    label: "rejects failed CI",
    conclusion: "failure",
    error: "Record PR tests must pass",
  },
  {
    ...valid,
    label: "rejects a closed PR",
    state: "closed",
    error: "The record PR must be open",
  },
])(
  "$label at the trusted workflow entry point",
  async ({ message, conclusion, state, error }) => {
    await using cleanup = new AsyncDisposableStack();
    const repos = await makeGitRepos();
    cleanup.defer(() => repos.dispose());
    const cwd = await repos.clone("trusted");
    const candidate = await repos.clone("task");
    const base = await git(cwd, "rev-parse", "HEAD");
    await repos.commit(candidate, "a.txt", { text: "a", message });
    const head = await repos.commit(candidate, "b.txt", { text: "b" });
    await git(candidate, "push", "origin", "HEAD:refs/pull/3/head");

    await writeFile(
      join(repos.root, "gh"),
      `#!/bin/sh
case "$2" in
  */pulls/3) echo "$PR" ;;
  */record-pr.yml/runs*) echo '{"workflow_runs":[{"id":1,"status":"completed","head_branch":"task","head_repository":{"full_name":"owner/repo"}}]}' ;;
  */runs/1/jobs*) echo "$JOBS" ;;
  *) exit 1 ;;
esac
`,
      { mode: 0o755 },
    );
    const result = run(
      process.execPath,
      [join(import.meta.dirname, "../scripts/land-verified.ts")],
      {
        cwd,
        env: {
          ...process.env,
          PATH: [repos.root, process.env.PATH].join(delimiter),
          GITHUB_REPOSITORY: "owner/repo",
          LAND_PULL: "3",
          LAND_HEAD: head,
          LAND_BASE: base,
          PR: JSON.stringify({
            number: 3,
            state,
            base: { ref: "main", sha: base },
            head: { ref: "task", sha: head, repo: { full_name: "owner/repo" } },
          }),
          JOBS: JSON.stringify({
            jobs: [
              { name: "Record PR tests", status: "completed", conclusion },
            ],
          }),
        },
      },
    );
    const diagnostic = await result.then(
      () => "",
      (failure: Error) => failure.message,
    );
    expect(Boolean(diagnostic)).toBe(Boolean(error));
    expect(diagnostic).toContain(error);
    expect(await git(cwd, "rev-parse", "HEAD")).toBe(base);
  },
  30_000,
);
