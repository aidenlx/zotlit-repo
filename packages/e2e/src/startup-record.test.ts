import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { pluginStartupMs, startupCheck, summarize } from "./startup-record.ts";

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

describe("startupCheck", () => {
  const summary = {
    zotlit: {
      cold: summarize([150, 170, 160]),
      warm: summarize([95, 80, 85, 90]),
    },
    "zotlit-reader": { cold: summarize([40]), warm: summarize([30]) },
  };

  it("passes a warm median at or under its budget and records a plugin with no budget", () => {
    expect(
      startupCheck(summary, { zotlit: 90, "zotlit-reader": undefined }),
    ).toEqual({
      lines: [
        "zotlit: warm median 87.5 ms, cold median 160 ms, warm budget 90 ms",
        "zotlit-reader: warm median 30 ms, cold median 40 ms, no warm budget",
      ],
      failures: [],
    });
  });

  it("fails a warm median above its budget with the delta", () => {
    expect(startupCheck(summary, { zotlit: 80 }).failures).toEqual([
      "zotlit: warm median 87.5 ms is above its budget of 80 ms by 7.5 ms",
    ]);
  });
});
