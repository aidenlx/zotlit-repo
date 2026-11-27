import { describe, expect, it } from "vitest";

import { hookTotals, moduleTiming, runTimings } from "./run-timings.ts";

const module = {
  file: "src/reader.e2e.ts",
  project: "desktop",
  ms: 30_000,
  collectMs: 400,
  setupMs: 100,
  prepareMs: 50,
};

describe("the End-to-end Run timings", () => {
  it("sums each hook of one scope, slowest first", () => {
    expect(
      hookTotals([
        { scope: "(each test)", name: "beforeEach", ms: 20 },
        { scope: "reader", name: "beforeAll", ms: 900 },
        { scope: "(each test)", name: "beforeEach", ms: 30 },
        { scope: "(each test)", name: "afterEach", ms: 10 },
      ]),
    ).toEqual([
      { scope: "reader", name: "beforeAll", ms: 900 },
      { scope: "(each test)", name: "beforeEach", ms: 50 },
      { scope: "(each test)", name: "afterEach", ms: 10 },
    ]);
  });

  it("gives a file its hook and test totals and lists its slowest test first", () => {
    const timing = moduleTiming(
      module,
      [
        { scope: "reader", name: "beforeAll", ms: 900 },
        { scope: "(each test)", name: "afterEach", ms: 40 },
      ],
      [
        { name: "reader > opens", state: "passed", ms: 100 },
        { name: "reader > scrolls", state: "failed", ms: 700 },
      ],
    );
    expect(timing).toMatchObject({ hookMs: 900, eachHookMs: 40, testMs: 800 });
    expect(timing.tests.map(({ name }) => name)).toEqual([
      "reader > scrolls",
      "reader > opens",
    ]);
  });

  it("totals the run and lists its slowest file first", () => {
    const fast = moduleTiming(
      { ...module, file: "src/a.e2e.ts", ms: 10 },
      [],
      [],
    );
    const slow = moduleTiming(
      { ...module, file: "src/b.e2e.ts", ms: 90 },
      [],
      [],
    );
    const run = runTimings([fast, slow]);
    expect(run.ms).toBe(100);
    expect(run.modules.map(({ file }) => file)).toEqual([
      "src/b.e2e.ts",
      "src/a.e2e.ts",
    ]);
  });
});
