import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkBundle } from "./bundle-gate.ts";

const plugin = {
  budget: { mainJsBytes: 100, stylesCssBytes: 20 },
  allowedRequires: ["obsidian"],
};

let dist = "";
beforeEach(async () => {
  dist = await mkdtemp(join(tmpdir(), "bundle-gate-"));
});
afterEach(() => rm(dist, { recursive: true, force: true }));

async function bundle(mainJs: string, stylesCss: string): Promise<void> {
  await writeFile(join(dist, "main.js"), mainJs);
  await writeFile(join(dist, "styles.css"), stylesCss);
}

describe("checkBundle", () => {
  it("passes a build under its budgets that requires only allowed modules", async () => {
    await bundle('var o=require("obsidian");', ".a{}");
    const report = await checkBundle("reader", plugin, dist);
    expect(report.failures).toEqual([]);
    expect(report.lines).toEqual([
      "main.js 26 B, budget 100 B",
      "styles.css 4 B, budget 20 B",
    ]);
  });

  it("names the size, the budget and the delta of a file above its budget", async () => {
    await bundle(`require("obsidian");${"x".repeat(1_190)}`, ".a{}".repeat(6));
    const report = await checkBundle("reader", plugin, dist);
    expect(report.failures).toEqual([
      "main.js is 1,210 B, above its budget of 100 B by 1,110 B",
      "styles.css is 24 B, above its budget of 20 B by 4 B",
    ]);
  });

  it("names a required module outside the allowed list", async () => {
    await bundle(
      `require("obsidian");require('node:fs');require("node:fs")`,
      "",
    );
    const report = await checkBundle("reader", plugin, dist);
    expect(report.failures).toEqual([
      'main.js requires "node:fs", which is not in its allowedRequires',
    ]);
  });
});
