import { describe, expect, it } from "vitest";

import { releaseLine } from "./lines.ts";
import { parseRemoteTags, planProduct } from "./plan.ts";

describe("planProduct", () => {
  const tags = new Set(["2.2.4", "zt-2.2.4"]);

  it("publishes a version of either line while its tag is missing", () => {
    expect(
      planProduct({ product: "obsidian", version: "2.3.0-beta.0", tags }),
    ).toMatchObject({ publish: true, tag: "2.3.0-beta.0" });
    expect(
      planProduct({ product: "zotero", version: "2.3.0", tags }),
    ).toMatchObject({ publish: true, tag: "zt-2.3.0" });
  });

  it("tags a Resource Pack version with its own prefix, on its own version line", () => {
    expect(
      planProduct({
        product: "resources",
        version: "1.0.0-beta.0",
        tags: new Set(["resources-1.0.0-beta.0"]),
      }),
    ).toMatchObject({ publish: false, tag: "resources-1.0.0-beta.0" });
  });

  it("stops once the source repository has the release tag, the last step of a publish", () => {
    expect(
      planProduct({ product: "zotero", version: "2.2.4", tags }),
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
