import { describe, expect, it } from "vitest";

import { bumpOptions, releaseRoute, resolveVersionSpec } from "./bump.ts";

const kinds = (current: string, branch: "next" | "main") =>
  bumpOptions(current, branch).map(({ kind }) => kind);

describe("bumpOptions", () => {
  it("offers main the patch bump alone: main takes hotfixes", () => {
    expect(bumpOptions("2.3.0", "main")).toEqual([
      { kind: "patch", version: "2.3.1" },
    ]);
  });

  it("leaves out the bumps that do not follow from a pre-release on next", () => {
    expect(kinds("2.3.0-beta.1", "next")).toEqual([
      "minor",
      "major",
      "preminor",
      "premajor",
      "prerelease",
    ]);
  });

  it("keeps the pre-release identifier of the current version", () => {
    expect(resolveVersionSpec("2.3.0-rc.1", "prerelease", "next")).toBe(
      "2.3.0-rc.2",
    );
  });
});

describe("resolveVersionSpec", () => {
  it("takes an explicit version, normalized", () => {
    expect(resolveVersionSpec("2.2.4", "v2.3.0-beta.0", "next")).toBe(
      "2.3.0-beta.0",
    );
  });

  it("refuses a bump the branch does not offer", () => {
    expect(resolveVersionSpec("2.3.0", "minor", "main")).toBeNull();
  });
});

describe("releaseRoute", () => {
  it("lands pre-releases from next on the beta line", () => {
    expect(releaseRoute(["2.3.0-beta.0"], "next", 2)).toEqual({
      route: "beta",
    });
  });

  it("graduates stable versions from next when every app takes one", () => {
    expect(releaseRoute(["2.3.0", "2.3.0"], "next", 2)).toEqual({
      route: "graduation",
    });
  });

  it("refuses a graduation of one app, since the apps graduate together", () => {
    expect(releaseRoute(["2.3.0"], "next", 2)).toHaveProperty("error");
  });

  it("refuses stable and pre-release versions in one release from next", () => {
    expect(releaseRoute(["2.3.0", "2.4.0-beta.0"], "next", 2)).toHaveProperty(
      "error",
    );
  });

  it("takes stable versions on main as a hotfix and refuses a pre-release there", () => {
    expect(releaseRoute(["2.3.1"], "main", 2)).toEqual({ route: "hotfix" });
    expect(releaseRoute(["2.3.1-beta.0"], "main", 2)).toHaveProperty("error");
  });
});
