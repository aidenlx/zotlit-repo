import { describe, expect, it } from "vitest";

import { cleanCiLine, failedLogExcerpt } from "./ci-log.ts";

const ESCAPE = String.fromCharCode(27);
const stamp = (text: string) => `2026-11-27T05:59:33.6038680Z ${text}`;

describe("failedLogExcerpt", () => {
  it("starts at the first failure, ends at the runner error, and drops timestamps and colours", () => {
    const raw = [
      stamp("Run pnpm verify --pr --shard=1/3"),
      stamp(" ✓ src/core/find/find.test.ts (2 tests) 900ms"),
      stamp(
        `${ESCAPE}[41m${ESCAPE}[1m FAIL ${ESCAPE}[22m${ESCAPE}[49m src/core/persist/persist.test.ts > reopens a file`,
      ),
      stamp("AssertionError: expected 59.99 to be less than 2"),
      stamp(""),
      stamp("##[error]Process completed with exit code 1."),
      stamp("Post job cleanup."),
      stamp("[command]/usr/bin/git version"),
    ].join("\n");

    expect(failedLogExcerpt(raw)).toEqual([
      " FAIL  src/core/persist/persist.test.ts > reopens a file",
      "AssertionError: expected 59.99 to be less than 2",
      "##[error]Process completed with exit code 1.",
    ]);
  });

  it("keeps the last lines before the runner error when no failure marker shows", () => {
    const raw = ["a", "b", "c", "##[error]exit 2", "cleanup"]
      .map(stamp)
      .join("\n");

    expect(failedLogExcerpt(raw, 2)).toEqual(["b", "c", "##[error]exit 2"]);
  });

  it("skips the runner errors that come before the failed task's log", () => {
    const raw = [
      "##[error]command (packages/pdf-reader) pnpm run test exited (1)",
      " ❯ src/a.test.ts (1 test | 1 failed) 20ms",
      "##[error]AssertionError: expected 1 to be 2",
      "##[error]Process completed with exit code 1.",
      "Post job cleanup.",
    ]
      .map(stamp)
      .join("\n");

    expect(failedLogExcerpt(raw)).toEqual([
      " ❯ src/a.test.ts (1 test | 1 failed) 20ms",
      "##[error]Process completed with exit code 1.",
    ]);
  });

  it("keeps the runner error when the failure section is longer than the limit", () => {
    const raw = [" FAIL x", "1", "2", "3", "##[error]exit 1"]
      .map(stamp)
      .join("\n");

    expect(failedLogExcerpt(raw, 2)).toEqual([
      " FAIL x",
      "1",
      "##[error]exit 1",
    ]);
  });
});

describe("failedLogExcerpt on a Vitest run", () => {
  it("starts at the Failed Tests section and leaves out the passing tests", () => {
    const raw = [
      " ❯ src/desktop/source.test.ts (40 tests | 1 failed) 31000ms",
      "     ✓ first build, stopped before the key check answers 303ms",
      "     × releases a read that lands after teardown 15002ms",
      "     ✓ first build, stopped before the group list answers 320ms",
      "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯",
      " FAIL  src/desktop/source.test.ts > lifetime guards > releases a read",
      "Error: Test timed out in 15000ms.",
      " ❯ src/desktop/source.test.ts:1371:8",
      "      Tests  1 failed | 579 passed (580)",
      "##[error]Error: Test timed out in 15000ms.",
      "[ELIFECYCLE] Test failed. See above for more details.",
      "##[error]Process completed with exit code 1.",
    ]
      .map(stamp)
      .join("\n");

    expect(failedLogExcerpt(raw)).toEqual([
      "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯",
      " FAIL  src/desktop/source.test.ts > lifetime guards > releases a read",
      "Error: Test timed out in 15000ms.",
      " ❯ src/desktop/source.test.ts:1371:8",
      "      Tests  1 failed | 579 passed (580)",
      "[ELIFECYCLE] Test failed. See above for more details.",
      "##[error]Process completed with exit code 1.",
    ]);
  });
});

describe("cleanCiLine", () => {
  it("removes terminal control sequences and control bytes that a job log can hold", () => {
    const osc = `${ESCAPE}]52;c;Y3VybCB4${String.fromCharCode(7)}`;
    const link = `${ESCAPE}]8;;https://example.test${ESCAPE}\\text${ESCAPE}]8;;${ESCAPE}\\`;
    const screen = `${ESCAPE}[?1049h${ESCAPE}[2K`;
    const bytes = `a\rb${String.fromCharCode(8)}c${String.fromCharCode(0x9b)}d\te`;

    expect(cleanCiLine(stamp(`${osc}${link}${screen}${bytes}`))).toBe(
      "textabcd\te",
    );
  });

  it("leaves a line without a timestamp or colour as it is", () => {
    expect(cleanCiLine("[command]/usr/bin/git version")).toBe(
      "[command]/usr/bin/git version",
    );
  });

  it("drops a colour code that GitHub stored without its escape character", () => {
    expect(cleanCiLine(stamp("[41m[1m FAIL [22m[49m a.test.ts"))).toBe(
      " FAIL  a.test.ts",
    );
  });
});
