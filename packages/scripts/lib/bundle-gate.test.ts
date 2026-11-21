import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { writePack } from "@zotlit/resource-pack/writer.ts";

import { checkBundle } from "./bundle-gate.ts";
import { bundledPlugin, CONTAINER_PLUGIN } from "./shell/profiles.ts";

const scratch = await mkdtemp(join(tmpdir(), "zt-bundle-gate-"));
afterAll(() => rm(scratch, { recursive: true, force: true }));

/** A host app's folder: its package.json, and the files of its `dist/`. */
async function app(
  name: string,
  packageJson: object,
  dist: Record<string, string | Uint8Array>,
) {
  const dir = join(scratch, name);
  await mkdir(join(dir, "dist"), { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify(packageJson));
  for (const [file, content] of Object.entries(dist)) {
    await writeFile(join(dir, "dist", file), content);
  }
  return dir;
}

const budget = { mainJsBytes: 1_000, stylesCssBytes: 10 };

describe("checkBundle", () => {
  it("holds a bundled plugin to its budgets and its allowedRequires", async () => {
    const dir = await app(
      "bundled",
      {},
      {
        "main.js": 'require("obsidian"); require("node:fs");',
        "styles.css": ".a{color:red}",
      },
    );
    const report = await checkBundle(
      "bundled",
      {
        profile: bundledPlugin({ resources: "Language Packs" }),
        budget,
        allowedRequires: ["obsidian"],
      },
      dir,
    );
    expect(report.lines).toEqual([
      "main.js 40 B, budget 1,000 B",
      "styles.css 13 B, budget 10 B",
    ]);
    expect(report.failures).toEqual([
      "styles.css is 13 B, above its budget of 10 B by 3 B",
      'main.js requires "node:fs", which is not in its allowedRequires',
    ]);
  });

  it("reads a container's Pack Entries back as the pins of its package.json, with no stylesheet", async () => {
    const bytes = new TextEncoder().encode("\0asm alpha");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const main = await writePack({
      entries: [{ name: "alpha", bytes: new Uint8Array(bytes), sha256 }],
    });
    const dir = await app(
      "container",
      { packEntries: { alpha: { version: "1.0.0", sha256 } } },
      { "main.js": main },
    );
    const report = await checkBundle(
      "container",
      {
        profile: CONTAINER_PLUGIN,
        budget: { mainJsBytes: 100_000, stylesCssBytes: 0 },
        allowedRequires: ["obsidian"],
      },
      dir,
    );
    expect(report.failures).toEqual([]);
    expect(report.lines.at(-1)).toBe("alpha 10 B, read back as its pin");
  });

  it("fails a container whose main.js is no pack", async () => {
    const dir = await app(
      "no-pack",
      { packEntries: {} },
      { "main.js": "module.exports = class {};" },
    );
    const report = await checkBundle(
      "no-pack",
      { profile: CONTAINER_PLUGIN, budget, allowedRequires: [] },
      dir,
    );
    expect(report.failures).toEqual([
      "main.js does not start with a pack index",
    ]);
  });
});
