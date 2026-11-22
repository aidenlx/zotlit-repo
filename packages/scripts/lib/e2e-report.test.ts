import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fakeIssues } from "./__fixtures__/e2e-issues.ts";
import {
  E2E_ISSUE_TITLE,
  failedE2eCases,
  MAX_CASE_ISSUES,
  readFailedE2eCases,
  reportE2eFailure,
} from "./e2e-report.ts";
import type { E2eCase } from "./e2e-report.ts";

const REPO = "owner/repo";

const results = (root: string) =>
  JSON.stringify({
    testResults: [
      {
        name: `${root}/packages/e2e/src/reader.e2e.ts`,
        status: "failed",
        message: "",
        assertionResults: [
          {
            ancestorTitles: ["End-to-end Run", "the reader"],
            title: "opens a PDF",
            status: "failed",
            failureMessages: ["AssertionError: expected 6 to be 7\n    at x"],
          },
          {
            ancestorTitles: ["End-to-end Run", "the reader"],
            title: "closes a PDF",
            status: "passed",
          },
        ],
      },
      {
        name: `${root}/packages/e2e/src/broken.e2e.ts`,
        status: "failed",
        message: "Cannot find module 'x'",
        assertionResults: [],
      },
      {
        name: `${root}/packages/e2e/src/fine.e2e.ts`,
        status: "passed",
        message: "",
        assertionResults: [],
      },
    ],
  });

describe("failedE2eCases", () => {
  it("names each failed case by its file, its blocks and its title, and a file that failed outside its cases by the file", () => {
    expect(failedE2eCases(results("/workspace"))).toEqual([
      {
        id: "src/reader.e2e.ts > End-to-end Run > the reader > opens a PDF",
        title: "src/reader.e2e.ts > opens a PDF",
        message: "AssertionError: expected 6 to be 7\n    at x",
      },
      {
        id: "src/broken.e2e.ts",
        title: "src/broken.e2e.ts",
        message: "Cannot find module 'x'",
      },
    ]);
  });

  it("gives a case one ID in the Run Container and in a checkout whose path repeats the package path", () => {
    expect(
      failedE2eCases(results("/home/me/packages/e2e/checkout")).map(
        ({ id }) => id,
      ),
    ).toEqual(failedE2eCases(results("/workspace")).map(({ id }) => id));
  });
});

describe("readFailedE2eCases", () => {
  it("names no case when the run wrote no results, or only a part of them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "e2e-results-"));
    try {
      expect(await readFailedE2eCases(directory)).toEqual([]);
      await writeFile(join(directory, "results.json"), '{"testResults": [');
      expect(await readFailedE2eCases(directory)).toEqual([]);
      await writeFile(join(directory, "results.json"), results("/workspace"));
      expect(await readFailedE2eCases(directory)).toHaveLength(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

const failedCase = (name: string): E2eCase => ({
  id: `src/a.e2e.ts > block > ${name}`,
  title: `src/a.e2e.ts > ${name}`,
  message: `AssertionError of ${name}`,
});

const ESC = "\u001B";
const LOG = [
  "first line",
  ...Array.from({ length: 79 }, (_, at) => `line ${at}`),
  `${ESC}[31mlast line${ESC}[39m`,
].join("\n");

const report = (
  issues: ReturnType<typeof fakeIssues>,
  cases: readonly E2eCase[],
  log = LOG,
) =>
  reportE2eFailure(issues.client, REPO, {
    introduction: ["The introduction.", ""],
    evidence: "The evidence is there.",
    log,
    cases,
  });

const runIssue = (number: number, title = E2E_ISSUE_TITLE) => ({
  number,
  title,
  url: `u${number}`,
  body: "",
  state: "open" as const,
});

describe("reportE2eFailure", () => {
  it("opens one needs-triage issue for each failed case", async () => {
    const issues = fakeIssues();

    const urls = await report(issues, [failedCase("one"), failedCase("two")]);

    expect(issues.created).toMatchObject([
      { title: "e2e: src/a.e2e.ts > one", label: "needs-triage" },
      { title: "e2e: src/a.e2e.ts > two", label: "needs-triage" },
    ]);
    const { body } = issues.created[0]!;
    expect(body).toContain("src/a.e2e.ts > block > one");
    expect(body).toContain("AssertionError of one");
    expect(body).not.toContain("AssertionError of two");
    expect(body).toContain("The introduction.");
    expect(body).toContain("The evidence is there.");
    expect(body).not.toContain("last line");
    expect(issues.repositories).toEqual(new Set([REPO]));
    expect(urls).toEqual([
      "https://github.com/owner/repo/issues/101",
      "https://github.com/owner/repo/issues/102",
    ]);
  });

  it("comments on the case's open issue for a repeat, also after the issue got another title", async () => {
    const issues = fakeIssues();
    await report(issues, [failedCase("one"), failedCase("two")]);
    issues.change(102, { title: "The reader loses its focus" });

    const urls = await report(issues, [failedCase("two")]);

    expect(issues.created).toHaveLength(2);
    expect(issues.comments).toMatchObject([
      {
        number: 102,
        body: expect.stringContaining("AssertionError of two") as string,
      },
    ]);
    expect(urls).toEqual(["https://github.com/owner/repo/issues/102"]);
  });

  it("opens a new issue for a case whose issue is closed", async () => {
    const issues = fakeIssues();
    await report(issues, [failedCase("one")]);
    issues.change(101, { state: "closed" });

    await report(issues, [failedCase("one")]);

    expect(issues.created).toHaveLength(2);
    expect(issues.comments).toEqual([]);
  });

  it("keeps two cases with the same title in different blocks apart", async () => {
    const issues = fakeIssues();
    const twin = {
      ...failedCase("one"),
      id: "src/a.e2e.ts > other block > one",
    };

    await report(issues, [failedCase("one")]);
    await report(issues, [twin]);

    expect(issues.created).toHaveLength(2);
  });

  it("keeps the title of a long case within the limit of GitHub", async () => {
    const issues = fakeIssues();

    await report(issues, [failedCase("x".repeat(600))]);

    expect(issues.created[0]!.title.length).toBeLessThanOrEqual(256);
    expect(issues.created[0]!.body).toContain("x".repeat(600));
  });

  it("reports a run without a failed case to the newest open issue of the run", async () => {
    const issues = fakeIssues([
      { ...runIssue(3), state: "closed" },
      runIssue(5),
      runIssue(9, `${E2E_ISSUE_TITLE} under machine load`),
      runIssue(7),
    ]);

    const urls = await report(issues, []);

    expect(issues.created).toEqual([]);
    expect(issues.comments.map(({ number }) => number)).toEqual([7]);
    const { body } = issues.comments[0]!;
    expect(body).toContain("The introduction.");
    expect(body).toContain("The evidence is there.");
    expect(body).toContain("The results name no failed case.");
    expect(body).toContain("\nlast line\n");
    expect(body).not.toContain("first line");
    expect(urls).toEqual(["u7"]);
  });

  it("opens the issue of the run, and none per case, when more cases fail than the limit", async () => {
    const cases = Array.from({ length: MAX_CASE_ISSUES + 1 }, (_, at) =>
      failedCase(`case ${at}`),
    );
    const within = fakeIssues();
    const above = fakeIssues();

    await report(within, cases.slice(1));
    await report(above, cases);

    expect(within.created).toHaveLength(MAX_CASE_ISSUES);
    expect(above.created).toMatchObject([
      { title: E2E_ISSUE_TITLE, label: "needs-triage" },
    ]);
    for (const { id } of cases) expect(above.created[0]!.body).toContain(id);
  });

  it("keeps the report of a run in which every case fails within the body limit of GitHub", async () => {
    const issues = fakeIssues();

    await report(
      issues,
      Array.from({ length: 400 }, (_, at) =>
        failedCase(`${at} ${"x".repeat(1500)}`),
      ),
      Array.from({ length: 80 }, () => "y".repeat(2000)).join("\n"),
    );

    const { body } = issues.created[0]!;
    expect(body.length).toBeLessThan(65_536);
    expect(body).toContain("400 cases failed");
    expect(body).toContain("And 350 more.");
  });

  it("keeps the report of a case with a long message within the body limit of GitHub", async () => {
    const issues = fakeIssues();

    await report(issues, [
      { ...failedCase("one"), message: `${ESC}[31m${"z".repeat(100_000)}` },
    ]);

    const { body } = issues.created[0]!;
    expect(body.length).toBeLessThan(65_536);
    expect(body).not.toContain(ESC);
  });

  it("shows the end of the log for a hook that failed outside the cases, whose error the results do not hold", async () => {
    const issues = fakeIssues();

    await report(issues, [{ ...failedCase("one"), message: "" }]);

    expect(issues.created[0]!.body).toContain("\nlast line\n");
  });

  it("comments on the newest of several open issues of one case", async () => {
    const issues = fakeIssues();
    await report(issues, [failedCase("one")]);
    const { body } = issues.created[0]!;
    const twins = fakeIssues([
      { ...runIssue(4, "older"), body },
      { ...runIssue(8, "newer"), body },
      { ...runIssue(6, "middle"), body },
    ]);

    await report(twins, [failedCase("one")]);

    expect(twins.comments.map(({ number }) => number)).toEqual([8]);
  });

  it("keeps a message with a code fence inside its block", async () => {
    const issues = fakeIssues();

    await report(issues, [
      { ...failedCase("one"), message: "```\n@someone\n```" },
    ]);

    const { body } = issues.created[0]!;
    expect(body).toContain("~~~~~~text\n```\n@someone\n```\n~~~~~~");
  });
});
