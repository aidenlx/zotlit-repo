import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fakeIssues } from "./__fixtures__/e2e-issues.ts";
import { makeGitRepos } from "./__fixtures__/git-repos.ts";
import { E2E_ISSUE_TITLE } from "./e2e-report.ts";
import type { E2eCase } from "./e2e-report.ts";
import {
  githubRepository,
  readLandE2eEvidence,
  readLandE2eRecords,
  requestLandE2e,
  runLandE2e,
} from "./land-e2e.ts";
import type { LandE2eDeps, LandE2eOutcome } from "./land-e2e.ts";

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

const CASE: E2eCase = {
  id: "src/literature-notes.e2e.ts > End-to-end Run > renders a Literature Note",
  title: "src/literature-notes.e2e.ts > renders a Literature Note",
  message: "AssertionError: expected 6 to be 7",
};
const OTHER_CASE: E2eCase = {
  id: "src/reader.e2e.ts > End-to-end Run > opens a PDF",
  title: "src/reader.e2e.ts > opens a PDF",
  message: "AssertionError: expected 1 to be 2",
};

function deps(
  outcomes: Record<string, LandE2eOutcome> = {},
  {
    issues = fakeIssues(),
    cases = {},
  }: {
    issues?: ReturnType<typeof fakeIssues>;
    cases?: Record<string, E2eCase[]>;
  } = {},
) {
  const ran: string[] = [];
  const fake: LandE2eDeps = {
    run: ({ request: { commit } }) => {
      ran.push(commit);
      return Promise.resolve(outcomes[commit] ?? { outcome: "passed" });
    },
    evidence: ({
      range,
      run: {
        request: { commit },
      },
    }) =>
      Promise.resolve({
        commits: `abc1234 the commits of ${range}`,
        log: "the last line of the log",
        cases: cases[commit] ?? [CASE],
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

  it("reads the historical outcomes from host-desktop runs", async () => {
    const history = [
      { commit: "c1", result: { outcome: "skipped", reason: "no desktop" } },
      { commit: "c2", result: { outcome: "not-run", reason: "lid closed" } },
    ];
    const runs = history.map((record) =>
      JSON.stringify({
        ...record,
        range: `p0..${record.commit}`,
        startedAt: "2026-11-22T09:00:00Z",
        finishedAt: "2026-11-22T09:00:01Z",
        log: `${record.commit}.log`,
      }),
    );
    await writeFile(join(dir, "runs.jsonl"), `${runs.join("\n")}\n`);

    expect(await records()).toMatchObject(history);
  });
});

describe("the issues of End-to-end Run failures", () => {
  it("reports the failed case, for the range since the last tip that passed", async () => {
    const { fake, created, comments } = deps({ c2: FAILED });
    await request("c1", "c0");
    await runner(fake);
    await request("c2", "c1b");
    await runner(fake);
    await runner(fake);

    expect(comments).toEqual([]);
    expect(created).toMatchObject([{ title: `e2e: ${CASE.title}` }]);
    const { body } = created[0]!;
    expect(body).toContain("`c1..c2`");
    expect(body).toContain("abc1234 the commits of c1..c2");
    expect(body).toContain(CASE.message);
    expect(body).not.toContain(dir);
    expect(body).toMatch(/`logs\/[^`]+-c2\.log` in the End-to-end state/);
    expect(await records()).toMatchObject([
      { commit: "c1", range: "c0..c1", result: { outcome: "passed" } },
      {
        commit: "c2",
        issues: ["https://github.com/owner/repo/issues/101"],
        result: { outcome: "failed" },
      },
    ]);
  });

  it("reports a failure before the run started to the issue of the run", async () => {
    const { fake, created } = deps(
      { c1: { outcome: "failed", stage: "checkout" } },
      { cases: { c1: [] } },
    );
    await request("c1");
    await runner(fake);

    expect(created).toMatchObject([
      {
        title: E2E_ISSUE_TITLE,
        body: expect.stringContaining(
          "the run failed at the checkout stage",
        ) as string,
      },
    ]);
  });

  it("comments once on the issue of each case that failed since the last pass, and leaves it open", async () => {
    const { fake, created, comments } = deps(
      { c1: FAILED, c2: FAILED },
      { cases: { c1: [CASE], c2: [OTHER_CASE] } },
    );
    await request("c1", "c0");
    await runner(fake);
    await request("c2", "c1");
    await runner(fake);
    await request("c3", "c2");
    await runner(fake);
    await request("c4", "c3");
    await runner(fake);

    expect(created).toHaveLength(2);
    expect(comments.map(({ number }) => number)).toEqual([101, 102]);
    for (const { body } of comments) {
      expect(body).toContain("passed");
      expect(body).toContain("c3");
    }
    const all = await records();
    expect(all).toMatchObject([
      { commit: "c1", result: { outcome: "failed" } },
      { commit: "c2", result: { outcome: "failed" } },
      {
        commit: "c3",
        issues: [
          "https://github.com/owner/repo/issues/101",
          "https://github.com/owner/repo/issues/102",
        ],
        result: { outcome: "passed" },
      },
      { commit: "c4", result: { outcome: "passed" } },
    ]);
    expect(all[3]).not.toHaveProperty("issues");
  });

  it("records the run when GitHub does not answer", async () => {
    const issues = fakeIssues();
    issues.client.listOpen = () => Promise.reject(new Error("offline"));
    const { fake } = deps({ c1: FAILED }, { issues });
    await request("c1");
    await runner(fake);

    const [record] = await records();
    expect(record).toMatchObject({ commit: "c1", result: FAILED });
    expect(record).not.toHaveProperty("issues");
  });

  it("gives each run a results folder of its own", async () => {
    const folders: string[] = [];
    const { fake } = deps();
    const run = fake.run;
    fake.run = (options) => {
      folders.push(options.resultsDir);
      return run(options);
    };
    await request("c1");
    await runner(fake);
    await request("c2", "c1");
    await runner(fake);

    expect(new Set(folders).size).toBe(2);
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
      await writeFile(
        join(dir, "results.json"),
        JSON.stringify({
          testResults: [
            {
              name: "/workspace/packages/e2e/src/a.e2e.ts",
              status: "failed",
              message: "",
              assertionResults: [
                {
                  ancestorTitles: ["block"],
                  title: "a case",
                  status: "failed",
                  failureMessages: ["AssertionError"],
                },
              ],
            },
          ],
        }),
      );

      const { commits, log, cases } = await readLandE2eEvidence({
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
          resultsDir: dir,
          progress: () => {},
          leaseEnded: new AbortController().signal,
        },
        range: "HEAD~1..HEAD",
      });

      expect(log).toBe(" FAIL  src/a.e2e.ts > a case\n");
      expect(cases).toEqual([
        {
          id: "src/a.e2e.ts > block > a case",
          title: "src/a.e2e.ts > a case",
          message: "AssertionError",
        },
      ]);
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
