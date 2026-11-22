import { describe, expect, it } from "vitest";

import { recordPrProblems } from "./record-pr-workflow.ts";

function workflow({
  name = "Record PR tests",
  timeout = 40,
  run = "pnpm verify --pr",
} = {}): string {
  return `name: Record PR
on:
  pull_request:
    branches: [main]
jobs:
  tests:
    name: ${name}
    runs-on: ubuntu-latest
    timeout-minutes: ${timeout}
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/setup-workspace
      - name: verify
        run: ${run}
`;
}

describe("recordPrProblems", () => {
  it("accepts the job that the land waits for", () => {
    expect(recordPrProblems(workflow())).toEqual([]);
  });

  it("reports a job renamed away from the check the land waits for", () => {
    expect(recordPrProblems(workflow({ name: "Tests" }))).toEqual([
      expect.stringContaining('named "Record PR tests"'),
    ]);
  });

  it("reports a timeout that the land's wait does not cover", () => {
    expect(recordPrProblems(workflow({ timeout: 50 }))).toEqual([
      expect.stringContaining("timeout-minutes is 50, not 40"),
    ]);
  });

  it("reports a job that runs a verify other than the PR half", () => {
    expect(recordPrProblems(workflow({ run: "pnpm verify" }))).toEqual([
      expect.stringContaining("must run `pnpm verify --pr` once"),
    ]);
  });
});
