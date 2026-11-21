import { describe, expect, it } from "vitest";

import { PUBLISHED_PLUGINS } from "./plugins.ts";
import type { PublishedPlugin } from "./plugins.ts";

describe("the profile of a published plugin", () => {
  it.each(Object.entries<PublishedPlugin>(PUBLISHED_PLUGINS))(
    "%s: the bundle package publishes each file the shell's build writes",
    (_name, { profile }) => {
      expect(profile.builtFiles).toContain("main.js");
      expect(profile.bundlePackage.files).toEqual(
        expect.arrayContaining([...profile.builtFiles]),
      );
    },
  );

  it("gives the Resource Pack main.js alone, and the bundled plugins a stylesheet too", () => {
    expect(PUBLISHED_PLUGINS.resources.profile.builtFiles).toEqual(["main.js"]);
    expect(PUBLISHED_PLUGINS.desktop.profile.builtFiles).toEqual([
      "main.js",
      "styles.css",
    ]);
    expect(PUBLISHED_PLUGINS.reader.profile.builtFiles).toEqual([
      "main.js",
      "styles.css",
    ]);
  });
});
