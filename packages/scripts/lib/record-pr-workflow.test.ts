import { describe, expect, it } from "vitest";

import { recordPrProblems } from "./record-pr-workflow.ts";

const SHARD_RUN =
  "pnpm verify --pr --shard=${{ matrix.shard }}/${{ strategy.job-total }}";

function workflow({
  name = "Record PR tests",
  shards = "[1, 2, 3]",
  timeout = 35,
  run = SHARD_RUN,
  condition = "always()",
  needs = "shard",
  result = 'test "$RESULT" = success',
} = {}): string {
  return `name: Record PR
on:
  pull_request:
    branches: [main]
jobs:
  shard:
    name: Record PR shard
    strategy:
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
          RESULT: \${{ needs.shard.result }}
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
