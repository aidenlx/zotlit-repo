import { describe, expect, it } from "vitest";

import { gateSteps, verifyHalf } from "./gate-halves.ts";
import { LAND_GATES } from "./land.ts";

describe("the gate halves", () => {
  it("gives the land the checks that need no hosted runner, and the record PR the tests and bundles", () => {
    expect(gateSteps("local")).toEqual([
      "Format",
      "Generated artifacts",
      "Lint",
      "Snapshot size",
      "Record risk",
      "Record file",
    ]);
    expect(gateSteps("pr")).toEqual(["Test", "Bundle"]);
  });

  it("checks the size of the agent guides on a branch that changes only agent docs", () => {
    expect(gateSteps("local", { agentDocsOnly: true })).toEqual([
      "Format",
      "Generated artifacts",
      "Agent guides",
    ]);
    expect(gateSteps("pr", { agentDocsOnly: true })).toEqual([]);
  });

  it("is the gate of a land of a change, and the run line of the record PR", () => {
    expect(LAND_GATES.change).toEqual(["pnpm", "verify", "--local"]);
    expect(verifyHalf("pr")).toEqual(["pnpm", "verify", "--pr"]);
  });
});
