import { resetSync } from "@logtape/logtape";
import { afterEach, describe, expect, it } from "vitest";

import { enableStartupLogging, pluginLogTape } from "./log.ts";

afterEach(() => resetSync());

// An `exit` listener on the host process outlives the plugin and holds its
// whole bundle in memory after a disable.
describe("configuring LogTape for the plugin", () => {
  it("leaves no exit listener on the host process at startup", () => {
    const before = process.listenerCount("exit");
    enableStartupLogging();
    expect(process.listenerCount("exit")).toBe(before);
  });

  it("leaves no exit listener on the host process on a reconfigure", () => {
    const before = process.listenerCount("exit");
    enableStartupLogging();
    pluginLogTape().configure({
      sinks: { none: () => {} },
      loggers: [{ category: ["zotlit"], sinks: ["none"] }],
    });
    expect(process.listenerCount("exit")).toBe(before);
  });
});
