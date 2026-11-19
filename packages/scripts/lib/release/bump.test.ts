import { describe, expect, it } from "vitest";

import { bumpOptions, resolveVersionSpec } from "./bump.ts";

const kinds = (current: string) => bumpOptions(current).map(({ kind }) => kind);

describe("bumpOptions", () => {
  it("offers every bump from a stable version, a beta and a stable release alike", () => {
    expect(kinds("2.3.0")).toEqual([
      "patch",
      "minor",
      "major",
      "prepatch",
      "preminor",
      "premajor",
      "prerelease",
    ]);
  });

  it("leaves out the bumps that do not follow from a pre-release", () => {
    expect(kinds("2.3.0-beta.1")).toEqual([
      "minor",
      "major",
      "preminor",
      "premajor",
      "prerelease",
    ]);
  });

  it("keeps the pre-release identifier of the current version", () => {
    expect(resolveVersionSpec("2.3.0-rc.1", "prerelease")).toBe("2.3.0-rc.2");
  });
});

describe("resolveVersionSpec", () => {
  it("takes an explicit version, normalized", () => {
    expect(resolveVersionSpec("2.2.4", "v2.3.0-beta.0")).toBe("2.3.0-beta.0");
  });

  it("refuses a bump that the current version does not offer", () => {
    expect(resolveVersionSpec("2.3.0-beta.1", "patch")).toBeNull();
  });
});
