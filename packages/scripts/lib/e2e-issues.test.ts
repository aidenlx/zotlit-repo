import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { githubE2eIssues } from "./e2e-issues.ts";

const STORED = [
  { number: 1, title: "a", url: "u1", body: "the marker", state: "open" },
  { number: 2, title: "b", url: "u2", body: "other", state: "closed" },
];

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "e2e-issues-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function option(args: readonly string[], name: string): string {
  return args[args.indexOf(name) + 1]!;
}

it("lists the open issues of the repository with what the report matches on", async () => {
  const issues = githubE2eIssues(directory, async (args) => {
    const fields = option(args, "--json").split(",");
    const state = option(args, "--state");
    if (option(args, "--repo") !== "owner/repo") return "[]";
    return JSON.stringify(
      STORED.filter((issue) => state === "all" || issue.state === state).map(
        (issue) =>
          Object.fromEntries(
            Object.entries(issue).filter(([field]) => fields.includes(field)),
          ),
      ),
    );
  });

  expect(await issues.listOpen("owner/repo")).toEqual([
    { number: 1, title: "a", url: "u1", body: "the marker" },
  ]);
});

it("passes the body of a new issue and of a comment through a file", async () => {
  const bodies: string[] = [];
  const issues = githubE2eIssues(directory, async (args) => {
    bodies.push(await readFile(option(args, "--body-file"), "utf8"));
    return `https://github.com/${option(args, "--repo")}/issues/${args[2]}\n`;
  });

  expect(
    await issues.create("owner/repo", {
      title: "a title",
      body: "a new body",
      label: "needs-triage",
    }),
  ).toMatch(/^https:\/\/github\.com\/owner\/repo\/issues\/\S+$/);
  await issues.comment("owner/repo", 7, "a comment");

  expect(bodies).toEqual(["a new body", "a comment"]);
});
