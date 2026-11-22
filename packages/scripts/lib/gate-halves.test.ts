import { describe, expect, it } from "vitest";

import { gateSteps, verifyHalf } from "./gate-halves.ts";
import { LAND_GATES } from "./land.ts";

describe("the gate halves", () => {
  it("gives the land the checks that need no hosted runner, and the record PR the tests and bundles", () => {
    expect(gateSteps("local")).toEqual([
      "Format",
      "Generated artifacts",
      "Lint",
      "Typecheck",
      "Snapshot size",
    ]);
    expect(gateSteps("pr")).toEqual(["Test", "Bundle"]);
  });

  it("is the gate of a land of a change, and the run line of the record PR", () => {
    expect(LAND_GATES.change).toEqual(["pnpm", "verify", "--local"]);
    expect(verifyHalf("pr")).toEqual(["pnpm", "verify", "--pr"]);
  });
});
