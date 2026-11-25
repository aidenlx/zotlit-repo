import { describe, expect, it } from "vitest";

import { PLATFORM_MODULES, RUNTIMES } from "./runtime-table.ts";
import { HOST_MODULES } from "./shell/templates/scripts/build.mjs";

describe("RUNTIMES", () => {
  it("names the same host modules as the shell build leaves external", () => {
    const platform = Object.entries(PLATFORM_MODULES)
      .filter(([, capability]) => capability !== "node")
      .map(([name]) => name);
    expect(
      new Set([
        ...platform,
        ...RUNTIMES.mobileRenderer.modules,
        ...RUNTIMES.desktopWorker.modules,
      ]),
    ).toEqual(new Set(HOST_MODULES));
  });

  it("gives the desktop renderer every module of the Mobile renderer", () => {
    expect(RUNTIMES.desktopRenderer.modules).toEqual(
      expect.arrayContaining([...RUNTIMES.mobileRenderer.modules]),
    );
  });

  it("gives the Reader and Resource Pack only the obsidian module", () => {
    expect(RUNTIMES.obsidianModule.modules).toEqual(["obsidian"]);
  });

  it("gives the desktop Worker no module of the Obsidian renderer", () => {
    expect(
      RUNTIMES.desktopWorker.modules.filter((name) =>
        (RUNTIMES.mobileRenderer.modules as readonly string[]).includes(name),
      ),
    ).toEqual([]);
  });
});
