import { describe, expect, it } from "vitest";

import { releaseCli, releaseRequest } from "./site-release.ts";

async function parse(args: string[]) {
  const argv = await releaseCli(args, "origin/main")
    .exitProcess(false)
    .fail((message, error) => {
      throw error ?? new Error(message);
    })
    .parseAsync();
  return releaseRequest(argv);
}

describe("site:release arguments", () => {
  it.each([
    [["--pick", "271"], { pick: [271], bootstrap: false, dryRun: false }],
    [
      ["--pick", "271", "275", "--dry-run"],
      { pick: [271, 275], bootstrap: false, dryRun: true },
    ],
    [["--to", "abc123"], { to: "abc123", bootstrap: false, dryRun: false }],
    [["--to"], { to: undefined, bootstrap: false, dryRun: false }],
    [
      ["--revert-to", "site-1"],
      { revertTo: "site-1", bootstrap: false, dryRun: false },
    ],
    [
      ["--bootstrap", "--to", "abc123"],
      { to: "abc123", bootstrap: true, dryRun: false },
    ],
  ])("accepts the mode %j", async (args, request) => {
    expect(await parse(args)).toMatchObject(request);
  });

  it.each([
    [["--pick", "271", "--bootstrap"], "pick and bootstrap"],
    [["--pick", "271", "--to", "abc123"], "pick and to"],
    [["--pick", "271", "--revert-to", "site-1"], "pick and revert-to"],
    [["--revert-to", "site-1", "--bootstrap"], "revert-to and bootstrap"],
    [["--revert-to", "site-1", "--to", "abc123"], "revert-to and to"],
  ])("refuses the conflicting modes %j", async (args, pair) => {
    await expect(parse(args)).rejects.toThrow(
      `Arguments ${pair} are mutually exclusive`,
    );
  });

  it("asks for a mode when none is named", async () => {
    await expect(parse(["--dry-run"])).rejects.toThrow("Name a mode");
  });
});
