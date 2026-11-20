import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { pluginStartupMs } from "./startup-record.ts";

const capture = await readFile(
  join(import.meta.dirname, "__fixtures__", "dev-startup.json"),
  "utf8",
);

const FIXTURE_MS = { "zotlit-reader": 13, zotlit: 58.7 };

describe("pluginStartupMs", () => {
  it("reads each plugin's communityPlugins duration from a dev:startup capture", () => {
    expect(pluginStartupMs(capture, ["zotlit-reader", "zotlit"])).toEqual(
      FIXTURE_MS,
    );
  });

  it("names a plugin the capture does not report", () => {
    expect(() => pluginStartupMs(capture, ["other"])).toThrow(
      "dev:startup reports no communityPlugins.other: the plugin did not load",
    );
  });
});
