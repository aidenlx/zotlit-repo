import { describe, expect, it } from "vitest";

import { bumpOptions, lineConflict, resolveVersionSpec } from "./bump.ts";

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

describe("bumpOptions on a line", () => {
  it("offers the Resource Pack the pre-release bumps alone in a beta release of ZotLit", () => {
    expect(
      bumpOptions("1.0.0-beta.0", "beta").map(({ version }) => version),
    ).toEqual(["1.1.0-beta.0", "2.0.0-beta.0", "1.0.0-beta.1"]);
  });

  it("offers the stable bumps alone in a stable release of ZotLit", () => {
    expect(
      bumpOptions("1.0.0-beta.3", "stable").map(({ version }) => version),
    ).toEqual(["1.0.0", "1.0.0"]);
  });
});

describe("lineConflict", () => {
  it("refuses a stable pack version in a beta release of ZotLit, and a beta one in a stable release", () => {
    expect(
      lineConflict({ obsidian: "2.4.0-beta.1", resources: "1.0.0" }),
    ).toMatch(/1\.0\.0 .*stable.*2\.4\.0-beta\.1 .*beta/);
    expect(
      lineConflict({ obsidian: "2.4.0", resources: "1.0.0-beta.1" }),
    ).not.toBeNull();
  });

  it("accepts versions of one line, and a pack released alone", () => {
    expect(
      lineConflict({ obsidian: "2.4.0-beta.1", resources: "1.1.0-beta.0" }),
    ).toBeNull();
    expect(lineConflict({ resources: "1.0.0" })).toBeNull();
    expect(lineConflict({ obsidian: "2.4.0" })).toBeNull();
  });
});
