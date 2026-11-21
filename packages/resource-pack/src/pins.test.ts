import { describe, expect, it } from "vitest";

import { parsePackPins } from "./pins.ts";

describe("parsePackPins", () => {
  it("gives the pins that package.json states under packEntries", () => {
    expect(
      parsePackPins({
        name: "@zotlit/resources",
        packEntries: {
          "chinese-segmenter": { version: "2.4.0", sha256: "ab".repeat(32) },
        },
      }),
    ).toEqual({
      "chinese-segmenter": { version: "2.4.0", sha256: "ab".repeat(32) },
    });
  });

  it.each([
    ["no packEntries", { name: "@zotlit/resources" }],
    ["an entry without a hash", { packEntries: { alpha: { version: "1" } } }],
  ])("refuses a package.json with %s", (_case, packageJson) => {
    expect(() => parsePackPins(packageJson)).toThrow(
      "package.json needs `packEntries`",
    );
  });
});
