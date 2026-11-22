import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { githubE2eIssues } from "./e2e-issues.ts";

const STORED = Array.from({ length: 120 }, (_, at) => ({
  number: at + 1,
  title: `title ${at}`,
  url: `u${at}`,
  body: `body ${at}`,
  state: at === 1 ? "closed" : "open",
}));

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
    const limit = args.includes("--limit")
      ? Number(option(args, "--limit"))
      : 30;
    return JSON.stringify(
      STORED.filter((issue) => state === "all" || issue.state === state)
        .slice(0, limit)
        .map((issue) =>
          Object.fromEntries(
            Object.entries(issue).filter(([field]) => fields.includes(field)),
          ),
        ),
    );
  });

  expect(await issues.listOpen("owner/repo")).toEqual(
    STORED.filter(({ state }) => state === "open").map(
      ({ number, title, url, body }) => ({ number, title, url, body }),
    ),
  );
});

it("creates an issue with its title, label and body, and comments on the issue of that number", async () => {
  const calls: { args: string[]; body: string }[] = [];
  const issues = githubE2eIssues(directory, async (args) => {
    calls.push({
      args: args.filter((arg) => !arg.startsWith(directory)),
      body: await readFile(option(args, "--body-file"), "utf8"),
    });
    return "https://github.com/owner/repo/issues/9\n";
  });

  expect(
    await issues.create("owner/repo", {
      title: "a title",
      body: "a new body",
      label: "needs-triage",
    }),
  ).toBe("https://github.com/owner/repo/issues/9");
  await issues.comment("owner/repo", 7, "a comment");

  const [create, comment] = calls;
  expect(option(create!.args, "--title")).toBe("a title");
  expect(option(create!.args, "--label")).toBe("needs-triage");
  expect(option(create!.args, "--repo")).toBe("owner/repo");
  expect(create!.body).toBe("a new body");
  expect(comment!.args.slice(0, 3)).toEqual(["issue", "comment", "7"]);
  expect(option(comment!.args, "--repo")).toBe("owner/repo");
  expect(comment!.body).toBe("a comment");
});
