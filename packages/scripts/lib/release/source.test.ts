import { describe, expect, it } from "vitest";

import { latestStableVersion, offTrunkRelease } from "./source.ts";

const tags = [
  "2.2.3",
  "2.2.4",
  "2.3.0-beta.0",
  "res-2.2.4",
  "zt-2.2.4",
  "zt-2.3.0-beta.0",
  "zt0.2.0",
  "zotero-release",
];

describe("latestStableVersion", () => {
  it("reads the newest stable tag of the product and skips pre-releases and other tags", () => {
    expect(latestStableVersion("obsidian", tags)).toBe("2.2.4");
    expect(latestStableVersion("zotero", tags)).toBe("2.2.4");
  });

  it("compares versions, not tag text", () => {
    expect(latestStableVersion("obsidian", ["2.10.0", "2.9.1"])).toBe("2.10.0");
  });
});

describe("offTrunkRelease", () => {
  it("takes a patch of the latest stable release as a hotfix on its tag", () => {
    expect(
      offTrunkRelease({ product: "zotero", version: "2.2.5", tags }),
    ).toEqual({ ok: true, baseTag: "zt-2.2.4" });
  });

  it("refuses a pre-release, which publishes from main alone", () => {
    expect(
      offTrunkRelease({ product: "obsidian", version: "2.3.0-beta.1", tags }),
    ).toMatchObject({ ok: false });
  });

  it.each([
    ["the latest stable version again", "2.2.4"],
    ["an older version", "2.2.3"],
    ["a new minor version, which ships from main", "2.3.0"],
  ])("refuses %s", (_, version) => {
    expect(
      offTrunkRelease({ product: "obsidian", version, tags }),
    ).toMatchObject({ ok: false });
  });

  it("refuses a product with no stable release to patch", () => {
    expect(
      offTrunkRelease({ product: "obsidian", version: "0.0.1", tags: [] }),
    ).toMatchObject({ ok: false });
  });
});
