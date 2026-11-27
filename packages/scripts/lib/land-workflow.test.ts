import { describe, expect, it } from "vitest";

import { landWorkflowProblems } from "./land-workflow.ts";

function workflow({
  marker = '"<!-- zotlit-land: after-ci -->"',
  match = '*"$MARKER"*) ;;',
} = {}): string {
  return `name: Land verified commits
jobs:
  inputs:
    runs-on: ubuntu-latest
    steps:
      - name: Pick the record PR
        env:
          MARKER: ${marker}
        run: |
          case "$body" in
            ${match}
            *) exit 0 ;;
          esac
`;
}

describe("landWorkflowProblems", () => {
  it("accepts the marker that pnpm land --after-ci writes", () => {
    expect(landWorkflowProblems(workflow())).toEqual([]);
  });

  it("reports a marker that pnpm land --after-ci does not write", () => {
    expect(
      landWorkflowProblems(workflow({ marker: '"<!-- land: after-ci -->"' })),
    ).toEqual([
      expect.stringContaining('the steps set "<!-- land: after-ci -->"'),
    ]);
  });

  it("reports a step that sets the marker and does not match the body against it", () => {
    expect(
      landWorkflowProblems(workflow({ match: '*"after-ci"*) ;;' })),
    ).toEqual([
      expect.stringContaining('match the record PR body against *"$MARKER"*'),
    ]);
  });

  it("reports a workflow with no marker", () => {
    expect(
      landWorkflowProblems("name: Land\njobs:\n  land:\n    steps: []\n"),
    ).toEqual([expect.stringContaining("no step sets MARKER")]);
  });
});
