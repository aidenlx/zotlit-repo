import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { JsonTestResults } from "vitest/node";

export const E2E_ISSUE_TITLE = "End-to-end Run fails on main";
export const MAX_CASE_ISSUES = 5;
const E2E_ISSUE_LABEL = "needs-triage";
const EXCERPT_LINES = 80;
const EXCERPT_LENGTH = 20_000;
const LISTED_CASES = 50;
const LISTED_LENGTH = 30_000;
const MESSAGE_LENGTH = 4000;
const TITLE_LENGTH = 200;

export interface E2eIssue {
  number: number;
  title: string;
  url: string;
  body: string;
}

export interface E2eIssues {
  listOpen: (repository: string) => Promise<E2eIssue[]>;
  create: (
    repository: string,
    issue: { title: string; body: string; label: string },
  ) => Promise<string>;
  comment: (repository: string, number: number, body: string) => Promise<void>;
}

export interface E2eCase {
  id: string;
  title: string;
  message: string;
}

export interface E2eFailure {
  introduction: readonly string[];
  evidence: string;
  log: string;
  cases: readonly E2eCase[];
}

const E2E_PACKAGE = "packages/e2e/";

export function failedE2eCases(results: string): E2eCase[] {
  const { testResults } = JSON.parse(results) as Pick<
    JsonTestResults,
    "testResults"
  >;
  return testResults.flatMap(({ name, status, message, assertionResults }) => {
    const file = name.slice(name.lastIndexOf(E2E_PACKAGE) + E2E_PACKAGE.length);
    const failed = assertionResults.filter((each) => each.status === "failed");
    if (failed.length === 0 && status === "failed") {
      return [{ id: file, title: file, message }];
    }
    return failed.map(({ ancestorTitles, title, failureMessages }) => ({
      id: [file, ...ancestorTitles, title].join(" > "),
      title: `${file} > ${title}`,
      message: failureMessages?.[0] ?? "",
    }));
  });
}

export async function readFailedE2eCases(
  directory: string,
): Promise<E2eCase[]> {
  return readFile(join(directory, "results.json"), "utf8")
    .then(failedE2eCases)
    .catch(() => []);
}

export async function reportE2eFailure(
  issues: E2eIssues,
  repository: string,
  failure: E2eFailure,
): Promise<string[]> {
  const open = await issues.listOpen(repository);
  const { cases } = failure;
  if (cases.length === 0 || cases.length > MAX_CASE_ISSUES) {
    const run = newest(open.filter(({ title }) => title === E2E_ISSUE_TITLE));
    const body = runBody(failure);
    return [
      await publish(issues, repository, {
        open: run,
        title: E2E_ISSUE_TITLE,
        comment: body,
        body,
      }),
    ];
  }
  const urls: string[] = [];
  for (const each of cases) {
    const marker = caseMarker(each.id);
    const comment = caseBody(failure, each);
    urls.push(
      await publish(issues, repository, {
        open: newest(open.filter(({ body }) => body.includes(marker))),
        title: caseTitle(each.title),
        comment,
        body: `${comment}\n\n${marker}`,
      }),
    );
  }
  return urls;
}

async function publish(
  issues: E2eIssues,
  repository: string,
  issue: {
    open: E2eIssue | undefined;
    title: string;
    comment: string;
    body: string;
  },
): Promise<string> {
  if (issue.open) {
    await issues.comment(repository, issue.open.number, issue.comment);
    return issue.open.url;
  }
  return issues.create(repository, {
    title: issue.title,
    body: issue.body,
    label: E2E_ISSUE_LABEL,
  });
}

function newest(issues: readonly E2eIssue[]): E2eIssue | undefined {
  return issues.toSorted((a, b) => b.number - a.number)[0];
}

function caseMarker(id: string): string {
  return `<!-- zotlit-e2e-case: ${createHash("sha256").update(id).digest("hex").slice(0, 16)} -->`;
}

function caseTitle(title: string): string {
  const full = `e2e: ${title}`;
  return full.length > TITLE_LENGTH
    ? `${full.slice(0, TITLE_LENGTH - 1)}…`
    : full;
}

function caseBody(failure: E2eFailure, { id, message }: E2eCase): string {
  return [
    ...failure.introduction,
    "Failed case:",
    "",
    ...fenced(id),
    "",
    ...(message
      ? [
          ...fenced(stripVTControlCharacters(message).slice(0, MESSAGE_LENGTH)),
          "",
          failure.evidence,
        ]
      : [
          "A hook failed outside the cases of this file.",
          "",
          ...logExcerpt(failure),
        ]),
  ].join("\n");
}

function runBody(failure: E2eFailure): string {
  const { introduction, cases } = failure;
  return [
    ...introduction,
    ...(cases.length > 0
      ? [
          `${cases.length} cases failed, so they share this issue:`,
          "",
          ...fenced(
            cases
              .slice(0, LISTED_CASES)
              .map(({ id }) => id)
              .join("\n")
              .slice(0, LISTED_LENGTH),
          ),
          ...(cases.length > LISTED_CASES
            ? [`And ${cases.length - LISTED_CASES} more.`]
            : []),
        ]
      : ["The results name no failed case."]),
    "",
    ...logExcerpt(failure),
  ].join("\n");
}

function logExcerpt({ evidence, log }: E2eFailure): string[] {
  const lines = stripVTControlCharacters(log).trimEnd().split("\n");
  return [
    `${evidence} The last ${EXCERPT_LINES} lines:`,
    "",
    ...fenced(lines.slice(-EXCERPT_LINES).join("\n").slice(-EXCERPT_LENGTH)),
  ];
}

function fenced(text: string): string[] {
  return ["~~~~~~text", text, "~~~~~~"];
}
