import { describe, expect, it } from "vitest";

import { releaseLine } from "./lines.ts";
import { parseRemoteTags, planProduct } from "./plan.ts";

describe("planProduct", () => {
  const tags = new Set(["2.2.4", "zt-2.2.4"]);

  it("publishes a pre-release from next while its tag is missing", () => {
    expect(
      planProduct({
        product: "obsidian",
        version: "2.3.0-beta.0",
        branch: "next",
        tags,
      }),
    ).toMatchObject({ publish: true, tag: "2.3.0-beta.0" });
  });

  it("leaves a stable version on next for main, where it graduates", () => {
    expect(
      planProduct({
        product: "zotero",
        version: "2.3.0",
        branch: "next",
        tags,
      }),
    ).toMatchObject({ publish: false, tag: "zt-2.3.0" });
  });

  it("leaves a pre-release on main alone, since main ships the stable line", () => {
    expect(
      planProduct({
        product: "obsidian",
        version: "2.3.0-beta.0",
        branch: "main",
        tags,
      }),
    ).toMatchObject({ publish: false });
  });

  it("stops once the source repository has the release tag, the last step of a publish", () => {
    expect(
      planProduct({
        product: "zotero",
        version: "2.2.4",
        branch: "main",
        tags,
      }),
    ).toMatchObject({ publish: false, reason: "zt-2.2.4 is released." });
  });
});

describe("releaseLine", () => {
  it("reads the pre-release part, not a hyphen in build metadata", () => {
    expect(releaseLine("2.3.0-beta.0")).toBe("beta");
    expect(releaseLine("2.3.0+build-7")).toBe("stable");
  });
});

describe("parseRemoteTags", () => {
  it("names an annotated tag once, by its name without the peeled suffix", () => {
    const listed = [
      "aaa\trefs/tags/2.2.4",
      "bbb\trefs/tags/2.2.4^{}",
      "ccc\trefs/tags/zt-2.2.4",
    ].join("\n");
    expect([...parseRemoteTags(listed)]).toEqual(["2.2.4", "zt-2.2.4"]);
  });
});
