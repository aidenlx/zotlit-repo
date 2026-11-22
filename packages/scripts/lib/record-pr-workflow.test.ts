import { describe, expect, it } from "vitest";

import { recordPrProblems } from "./record-pr-workflow.ts";

const SHARD_RUN =
  "pnpm verify --pr --shard=${{ matrix.shard }}/${{ strategy.job-total }}";

function workflow({
  name = "Record PR tests",
  shards = "[1, 2, 3]",
  failFast = "false",
  timeout = 35,
  run = SHARD_RUN,
  condition = "always()",
  needs = "shard",
  result = 'test "$RESULT" = success',
  from = "${{ needs.shard.result }}",
} = {}): string {
  return `name: Record PR
on:
  pull_request:
    branches: [main]
jobs:
  shard:
    name: Record PR shard
    strategy:
      fail-fast: ${failFast}
      matrix:
        shard: ${shards}
    runs-on: ubuntu-latest
    timeout-minutes: ${timeout}
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/setup-workspace
      - name: verify
        run: ${run}
  tests:
    name: ${name}
    needs: ${needs}
    if: ${condition}
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - env:
          RESULT: ${from}
        run: ${result}
`;
}

describe("recordPrProblems", () => {
  it("accepts the shards and the check that the land waits for", () => {
    expect(recordPrProblems(workflow())).toEqual([]);
  });

  it("reports a job renamed away from the check the land waits for", () => {
    expect(recordPrProblems(workflow({ name: "Tests" }))).toEqual([
      expect.stringContaining('one named "Record PR tests"'),
    ]);
  });

  it("reports timeouts that the land's wait does not cover", () => {
    expect(recordPrProblems(workflow({ timeout: 50 }))).toEqual([
      expect.stringContaining("50 + 5, which do not add up to 40"),
    ]);
  });

  it.each([
    ["a verify other than the PR half", "pnpm verify"],
    ["a verify that is not one shard", "pnpm verify --pr"],
  ])("reports a shard that runs %s", (_, run) => {
    expect(recordPrProblems(workflow({ run }))).toEqual([
      expect.stringContaining("each shard must run"),
    ]);
  });

  it.each(["[1, 3]", "[0, 1, 2]", "[]"])(
    "reports the shards %s, which leave out a part of the work",
    (shards) => {
      expect(recordPrProblems(workflow({ shards }))).toEqual([
        expect.stringContaining("must count from 1"),
      ]);
    },
  );

  it("reports shards that cancel each other", () => {
    expect(recordPrProblems(workflow({ failFast: "true" }))).toEqual([
      expect.stringContaining("fail-fast: false"),
    ]);
  });

  it.each([
    ["the shard job", "    timeout-minutes: 35\n", "    "],
    ["the verify step", "      - name: verify\n", "        "],
    ["the check's job", "    timeout-minutes: 5\n", "    "],
    [
      "the check's step",
      "          RESULT: ${{ needs.shard.result }}\n",
      "        ",
    ],
  ])(
    "reports continue-on-error on %s, which hides a failure",
    (_, line, indent) => {
      const text = workflow().replace(
        line,
        `${line}${indent}continue-on-error: true\n`,
      );

      expect(recordPrProblems(text)).toEqual([
        expect.stringContaining("continue-on-error"),
      ]);
    },
  );

  it.each([
    ["the verify step", "      - name: verify\n"],
    ["the check's step", "          RESULT: ${{ needs.shard.result }}\n"],
  ])("reports an if on %s, which can skip it", (_, line) => {
    const text = workflow().replace(line, `${line}        if: false\n`);

    expect(recordPrProblems(text)).toEqual([
      expect.stringContaining("must not set `if`"),
    ]);
  });

  it("accepts continue-on-error on a step beside the verify step", () => {
    const text = workflow().replace(
      "      - uses: ./.github/actions/setup-workspace\n",
      "      - uses: ./.github/actions/setup-workspace\n        continue-on-error: true\n",
    );

    expect(text).toContain("continue-on-error: true");
    expect(recordPrProblems(text)).toEqual([]);
  });

  it("reports a check that takes its result from somewhere else", () => {
    expect(recordPrProblems(workflow({ from: "success" }))).toEqual([
      expect.stringContaining('"Record PR tests" must need "shard"'),
    ]);
  });

  it("reports a job beside the shards and the check", () => {
    const extra = `${workflow()}  other:
    name: Other
    runs-on: ubuntu-latest
`;

    expect(recordPrProblems(extra)).toEqual([
      expect.stringContaining('one named "Record PR tests"'),
    ]);
  });

  it.each([
    ["does not need the shards", { needs: "[]" }],
    ["runs only after a success", { condition: "success()" }],
    ["passes a cancelled shard", { result: "test $RESULT != failure" }],
  ])("reports a check that %s", (_, change) => {
    expect(recordPrProblems(workflow(change))).toEqual([
      expect.stringContaining('"Record PR tests" must need "shard"'),
    ]);
  });
});
