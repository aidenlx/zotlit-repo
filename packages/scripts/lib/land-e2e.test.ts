import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeGitRepos } from "./__fixtures__/git-repos.ts";
import {
  E2E_ISSUE_TITLE,
  githubRepository,
  readLandE2eEvidence,
  readLandE2eRecords,
  requestLandE2e,
  runLandE2e,
} from "./land-e2e.ts";
import type {
  LandE2eDeps,
  LandE2eIssue,
  LandE2eIssues,
  LandE2eOutcome,
} from "./land-e2e.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "land-e2e-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const request = (commit: string, previous = "p0") =>
  requestLandE2e(
    {
      commit,
      previous,
      repository: "/repo",
      issueRepository: "owner/repo",
      requestedAt: Temporal.Now.instant().toString(),
    },
    dir,
  );

type FakeIssue = LandE2eIssue & { state: "open" | "closed" };

function fakeIssues(existing: FakeIssue[] = []) {
  const issues = [...existing];
  const created: { title: string; body: string; label: string }[] = [];
  const comments: { number: number; body: string }[] = [];
  const client: LandE2eIssues = {
    listOpen: (_repository, title) =>
      Promise.resolve(
        issues
          .filter(
            (issue) => issue.state === "open" && issue.title.includes(title),
          )
          .map(({ number, title, url }) => ({ number, title, url })),
      ),
    create: (repository, issue) => {
      created.push(issue);
      const number = 100 + created.length;
      const url = `https://github.com/${repository}/issues/${number}`;
      issues.push({ number, title: issue.title, url, state: "open" });
      return Promise.resolve(url);
    },
    comment: (_repository, number, body) => {
      comments.push({ number, body });
      return Promise.resolve();
    },
  };
  return { client, created, comments };
}

const FAILED_CASE =
  "|desktop| src/literature-notes.e2e.ts > End-to-end Run > renders a Literature Note";
const FAILED_LOG = [
  "@zotlit/e2e:e2e:  ✓ |desktop| src/follow-mode.e2e.ts (2 tests) 9103ms",
  `@zotlit/e2e:e2e:  FAIL  ${FAILED_CASE}`,
  "@zotlit/e2e:e2e: ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯",
  `@zotlit/e2e:e2e:  FAIL  ${FAILED_CASE}`,
  "@zotlit/e2e:e2e: AssertionError: expected 6 to be 7",
].join("\n");

function deps(
  outcomes: Record<string, LandE2eOutcome> = {},
  issues = fakeIssues(),
) {
  const ran: string[] = [];
  const fake: LandE2eDeps = {
    run: ({ request: { commit } }) => {
      ran.push(commit);
      return Promise.resolve(outcomes[commit] ?? { outcome: "passed" });
    },
    evidence: ({ range }) =>
      Promise.resolve({
        commits: `abc1234 the commits of ${range}`,
        log: FAILED_LOG,
      }),
    issues: issues.client,
  };
  return { fake, ran, created: issues.created, comments: issues.comments };
}

const runner = (fake: LandE2eDeps) =>
  runLandE2e(fake, { dir, pollMs: 10, log: () => {} });

const records = () => readLandE2eRecords(100, dir);

const FAILED: LandE2eOutcome = { outcome: "failed", stage: "End-to-end Run" };

describe("the End-to-end Run after a land", () => {
  it("runs only the newest tip when several lands requested runs", async () => {
    const { fake, ran } = deps();
    await request("c1");
    await request("c2");
    await request("c3");

    await runner(fake);
    await runner(fake);
    await runner(fake);

    expect(ran).toEqual(["c3"]);
  });

  it("records a skip on a machine with no desktop, and opens no issue", async () => {
    const { fake, created, comments } = deps({
      c1: { outcome: "skipped", reason: "no desktop" },
    });
    await request("c1");

    await runner(fake);

    expect(created).toEqual([]);
    expect(comments).toEqual([]);
    expect(await records()).toMatchObject([
      { commit: "c1", result: { outcome: "skipped", reason: "no desktop" } },
    ]);
  });
});

describe("the issue of End-to-end Run failures", () => {
  it("opens one needs-triage issue when none is open, for the range since the last tip that passed", async () => {
    const { fake, created, comments } = deps({ c2: FAILED });
    await request("c1", "c0");
    await runner(fake);
    await request("c2", "c1b");
    await runner(fake);
    await runner(fake);

    expect(comments).toEqual([]);
    expect(created).toMatchObject([
      { title: E2E_ISSUE_TITLE, label: "needs-triage" },
    ]);
    const { body } = created[0]!;
    expect(body).toContain("`c1..c2`");
    expect(body).toContain("abc1234 the commits of c1..c2");
    expect(body).toContain("AssertionError: expected 6 to be 7");
    expect(body.split(`- \`${FAILED_CASE}\``)).toHaveLength(2);
    expect(body).not.toContain(dir);
    expect(body).toMatch(/`logs\/[^`]+-c2\.log` in the End-to-end state/);
    expect(await records()).toMatchObject([
      { commit: "c1", range: "c0..c1", result: { outcome: "passed" } },
      {
        commit: "c2",
        issue: "https://github.com/owner/repo/issues/101",
        result: { outcome: "failed" },
      },
    ]);
  });

  it("comments on the open issue of End-to-end Run failures, and opens no new one", async () => {
    const open = {
      number: 7,
      title: E2E_ISSUE_TITLE,
      url: "https://github.com/owner/repo/issues/7",
      state: "open" as const,
    };
    const { fake, created, comments } = deps(
      { c1: FAILED, c2: FAILED },
      fakeIssues([
        { ...open, number: 3, url: "u3", state: "closed" },
        { ...open, number: 5, url: "u5" },
        {
          ...open,
          number: 9,
          url: "u9",
          title: `${E2E_ISSUE_TITLE} under machine load`,
        },
        open,
      ]),
    );
    await request("c1", "c0");
    await runner(fake);
    await request("c2", "c1");
    await runner(fake);

    expect(created).toEqual([]);
    expect(comments.map(({ number }) => number)).toEqual([7, 7]);
    const { body } = comments[1]!;
    expect(body).toContain("`c1..c2`");
    expect(body).toContain(`- \`${FAILED_CASE}\``);
    expect(body).toContain("AssertionError: expected 6 to be 7");
    expect(await records()).toMatchObject([
      { commit: "c1", issue: open.url },
      { commit: "c2", issue: open.url },
    ]);
  });

  it("comments once on the open issue when a run passes after a failure, and leaves it open", async () => {
    const { fake, created, comments } = deps({ c1: FAILED });
    await request("c1", "c0");
    await runner(fake);
    await request("c2", "c1");
    await runner(fake);
    await request("c3", "c2");
    await runner(fake);

    expect(created).toHaveLength(1);
    expect(comments).toMatchObject([{ number: 101 }]);
    expect(comments[0]!.body).toContain("passed");
    expect(comments[0]!.body).toContain("c2");
    expect(await records()).toMatchObject([
      { commit: "c1", result: { outcome: "failed" } },
      {
        commit: "c2",
        issue: "https://github.com/owner/repo/issues/101",
        result: { outcome: "passed" },
      },
      { commit: "c3", result: { outcome: "passed" } },
    ]);
    expect((await records())[2]).not.toHaveProperty("issue");
  });

  it("records the run when GitHub does not answer", async () => {
    const issues = fakeIssues();
    issues.client.listOpen = () => Promise.reject(new Error("offline"));
    const { fake } = deps({ c1: FAILED }, issues);
    await request("c1");
    await runner(fake);

    const [record] = await records();
    expect(record).toMatchObject({ commit: "c1", result: FAILED });
    expect(record).not.toHaveProperty("issue");
  });
});

it("retries the same tip after the Memory Gate blocks the run", async () => {
  const blocked: LandE2eOutcome = {
    outcome: "blocked",
    reason: "the Memory Gate did not admit the run",
  };
  const outcomes: Record<string, LandE2eOutcome> = { c1: blocked };
  const { fake, ran, created } = deps(outcomes);
  await request("c1");
  await runner(fake);
  outcomes.c1 = { outcome: "passed" };
  await runner(fake);

  expect(ran).toEqual(["c1", "c1"]);
  expect(created).toEqual([]);
  expect(await records()).toMatchObject([
    { commit: "c1", result: blocked },
    { commit: "c1", result: { outcome: "passed" } },
  ]);
});

describe("the evidence of a failed run", () => {
  it("takes the log as the run left it, then appends the commits of the range", async () => {
    const repos = await makeGitRepos();
    try {
      const checkout = await repos.clone("checkout");
      await repos.commit(checkout, "a.txt", {
        text: "a\n",
        message: "the subject of the landed commit",
      });
      const logPath = join(dir, "run.log");
      await writeFile(logPath, " FAIL  src/a.e2e.ts > a case\n");

      const { commits, log } = await readLandE2eEvidence({
        run: {
          request: {
            commit: "HEAD",
            previous: "",
            repository: checkout,
            issueRepository: undefined,
            requestedAt: Temporal.Now.instant().toString(),
          },
          logPath,
          checkout,
          progress: () => {},
          leaseEnded: new AbortController().signal,
        },
        range: "HEAD~1..HEAD",
      });

      expect(log).toBe(" FAIL  src/a.e2e.ts > a case\n");
      expect(commits).toContain("the subject of the landed commit");
      expect(await readFile(logPath, "utf8")).toContain(
        "the subject of the landed commit",
      );
    } finally {
      await repos.dispose();
    }
  });
});

describe("githubRepository", () => {
  it.each([
    ["git@github.com:aidenlx/zotlit-repo.git", "aidenlx/zotlit-repo"],
    ["https://github.com/aidenlx/zotlit-repo", "aidenlx/zotlit-repo"],
    ["/srv/git/zotlit.git", undefined],
  ])("reads %s", (url, expected) => {
    expect(githubRepository(url)).toBe(expected);
  });
});
