import { regex } from "arkregex";
import { describe, expect, it } from "vitest";

import { runImageTag } from "./container-image.ts";

describe("Run Container image tag", () => {
  it("uses a stable tag for a given set of image inputs", () => {
    const inputs = ["linux/arm64", "12.3.4", "Dockerfile", "entry"];
    expect(runImageTag(inputs)).toBe(runImageTag([...inputs]));
    expect(runImageTag(inputs)).toMatch(regex("^zotlit-e2e:[0-9a-f]{16}$"));
  });

  it("changes when an image input changes", () => {
    expect(runImageTag(["linux/arm64", "12.3.4", "Dockerfile"])).not.toBe(
      runImageTag(["linux/arm64", "12.3.5", "Dockerfile"]),
    );
    expect(runImageTag(["ab", "c"])).not.toBe(runImageTag(["a", "bc"]));
  });
});
