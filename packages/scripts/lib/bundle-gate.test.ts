import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { writePack } from "@zotlit/resource-pack/writer.ts";

import {
  checkBundle,
  checkRequires,
  checkBundleRuntime,
  bundleFile,
} from "./bundle-gate.ts";
import { RUNTIMES } from "./runtime-table.ts";
import { bundledPlugin, CONTAINER_PLUGIN } from "./shell/profiles.ts";

const scratch = await mkdtemp(join(tmpdir(), "zt-bundle-gate-"));
afterAll(() => rm(scratch, { recursive: true, force: true }));

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
  it("fails a release bundle that holds text only a development build may hold", async () => {
    const dir = await app(
      "bundled",
      {},
      {
        "main.js": 'const k = "zotlit-zotero-web-api-url";',
        "styles.css": "",
      },
    );
    const report = await checkBundle(
      "bundled",
      {
        profile: bundledPlugin({ resources: "Language Packs" }),
        budget,
        runtime: RUNTIMES.obsidianModule,
        developmentOnly: ["zotlit-zotero-web-api-url"],
      },
      dir,
    );
    expect(report.failures).toEqual([
      'main.js holds "zotlit-zotero-web-api-url", which only a development build may hold',
    ]);
  });

  it("holds a bundled plugin to its budgets and its runtime's modules", async () => {
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
        runtime: RUNTIMES.obsidianModule,
      },
      dir,
    );
    expect(report.lines).toEqual([
      "main.js 40 B, budget 1,000 B",
      "styles.css 13 B, budget 10 B",
    ]);
    expect(report.failures).toEqual([
      "styles.css is 13 B, above its budget of 10 B by 3 B",
      'main.js requires "node:fs", which the obsidian module alone does not give',
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
        runtime: RUNTIMES.obsidianModule,
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
      { profile: CONTAINER_PLUGIN, budget, runtime: RUNTIMES.obsidianModule },
      dir,
    );
    expect(report.failures).toEqual([
      "main.js does not start with a pack index",
    ]);
  });
});

describe("checkRequires", () => {
  const code = 'require("obsidian"); require("node:fs");';

  it("lets the Mobile renderer require obsidian and fails a Node built-in", () => {
    expect(checkRequires("main.js", code, RUNTIMES.mobileRenderer)).toEqual({
      required: ["node:fs", "obsidian"],
      failures: [
        'main.js requires "node:fs", which the Obsidian Mobile renderer does not give',
      ],
    });
  });

  it("lets the desktop Worker require a Node built-in and fails obsidian", () => {
    expect(
      checkRequires("worker.js", code, RUNTIMES.desktopWorker).failures,
    ).toEqual([
      'worker.js requires "obsidian", which the desktop Worker does not give',
    ]);
  });
});

describe("checkRequires on a Web Worker", () => {
  it("fails every required module, a platform module and a Node built-in", () => {
    expect(
      checkRequires(
        "worker.js",
        'require("obsidian"); require("node:fs"); require("fs");',
        RUNTIMES.webWorker,
      ).failures,
    ).toEqual([
      'worker.js requires "fs", which a Web Worker does not give',
      'worker.js requires "node:fs", which a Web Worker does not give',
      'worker.js requires "obsidian", which a Web Worker does not give',
    ]);
  });
});

describe("checkBundleRuntime", () => {
  it("reports the size and the required modules of a built root", async () => {
    const dir = await app(
      "mobile",
      {},
      { "main.js": 'require("obsidian"); require("@codemirror/view");' },
    );
    const report = checkBundleRuntime(
      "mobile",
      await bundleFile(join(dir, "dist", "main.js")),
      RUNTIMES.mobileRenderer,
    );
    expect(report).toEqual({
      name: "mobile",
      lines: ["main.js 49 B", "requires @codemirror/view, obsidian"],
      failures: [],
    });
  });

  it("fails a built root that requires a module its runtime does not give", async () => {
    const dir = await app(
      "mobile-node",
      {},
      { "main.js": 'require("node:path");' },
    );
    const report = checkBundleRuntime(
      "mobile",
      await bundleFile(join(dir, "dist", "main.js")),
      RUNTIMES.mobileRenderer,
    );
    expect(report.failures).toEqual([
      'main.js requires "node:path", which the Obsidian Mobile renderer does not give',
    ]);
  });
});
