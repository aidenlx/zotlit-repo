import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DesktopPaint } from "./desktop-paint.ts";
import {
  E2E_ISSUE_TITLE,
  githubRepository,
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

// The runner's run, evidence, issues, and paint probe are the process,
// network, and OS boundaries: the real ones check out, bootstrap, drive the
// desktop, read git and the log, call `gh`, and ask macOS whether the desktop
// can paint.
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

const PAINTS: DesktopPaint = { state: "paints" };
const LID_CLOSED: DesktopPaint = {
  state: "cannot paint",
  machine: "no display is awake (Color LCD: asleep), and the screen is locked",
};

type FakeIssue = LandE2eIssue & { state: "open" | "closed" };

/** A fake of the issues of a GitHub repository, held in memory. */
function fakeIssues(existing: FakeIssue[] = []) {
  const issues = [...existing];
  const created: { title: string; body: string; label: string }[] = [];
  const comments: { number: number; body: string }[] = [];
  const client: LandE2eIssues = {
    // Like GitHub's search, it returns each open issue whose title holds the
    // words, not only the exact title.
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
// Vitest names a failed case twice: as it runs, and in the summary.
const FAILED_LOG = [
  "@zotlit/e2e:e2e:  ✓ |desktop| src/follow-mode.e2e.ts (2 tests) 9103ms",
  `@zotlit/e2e:e2e:  FAIL  ${FAILED_CASE}`,
  "@zotlit/e2e:e2e: ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯",
  `@zotlit/e2e:e2e:  FAIL  ${FAILED_CASE}`,
  "@zotlit/e2e:e2e: AssertionError: expected 6 to be 7",
].join("\n");

/**
 * Fakes of the runner's boundaries. `paints` answers the probes in order;
 * the last answer repeats.
 */
function deps(
  outcomes: Record<string, LandE2eOutcome> = {},
  paints: DesktopPaint[] = [PAINTS],
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
    paint: () =>
      Promise.resolve(paints.length > 1 ? paints.shift()! : paints[0]!),
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
    // The runners of the later lands find their tip already run.
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
    // The issue is public: it names the log under the state directory, not
    // its absolute path on the machine.
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
      [PAINTS],
      fakeIssues([
        // None is the open issue of End-to-end Run failures: one is closed,
        // one is older than the newest open one, one has a longer title.
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
    // A later pass adds nothing.
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
    const { fake } = deps({ c1: FAILED }, [PAINTS], issues);
    await request("c1");
    await runner(fake);

    const [record] = await records();
    expect(record).toMatchObject({ commit: "c1", result: FAILED });
    expect(record).not.toHaveProperty("issue");
  });
});

describe("the End-to-end Run after a land on a desktop that cannot paint", () => {
  it("records the tip as not run with the machine state, opens no issue, and runs the newer tip next", async () => {
    const { fake, ran, created, comments } = deps({}, [
      PAINTS,
      LID_CLOSED,
      PAINTS,
    ]);
    await request("c0");
    await runner(fake);
    await request("c1", "c0");
    await runner(fake);
    await request("c2", "c1");
    await runner(fake);

    expect(ran).toEqual(["c0", "c2"]);
    expect(created).toEqual([]);
    expect(comments).toEqual([]);
    expect(await records()).toMatchObject([
      { commit: "c0", result: { outcome: "passed" } },
      {
        commit: "c1",
        result: {
          outcome: "not-run",
          reason: `the desktop cannot paint a window: ${LID_CLOSED.machine}`,
        },
      },
      // The range of the newer tip starts at the last tip that passed, so it
      // holds the commits of the tip that did not run.
      { commit: "c2", range: "c0..c2", result: { outcome: "passed" } },
    ]);
  });

  it("records a failed run as not run when the desktop stopped painting during it", async () => {
    const { fake, ran, created, comments } = deps({ c1: FAILED }, [
      PAINTS,
      LID_CLOSED,
    ]);
    await request("c1");

    await runner(fake);

    expect(ran).toEqual(["c1"]);
    expect(created).toEqual([]);
    expect(comments).toEqual([]);
    expect(await records()).toMatchObject([
      {
        commit: "c1",
        result: {
          outcome: "not-run",
          reason: `the desktop stopped painting during the run: ${LID_CLOSED.machine}`,
        },
      },
    ]);
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
