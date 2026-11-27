import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

import { compareBuilds } from "./build-check.ts";
import { generateShell } from "./generate.ts";
import type { PublishedPluginName } from "./plugins.ts";
import { PUBLISHED_PLUGINS } from "./plugins.ts";

import { getWorkspaceRoot } from "#package-roots";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const scratch = await mkdtemp(join(tmpdir(), "zt-shell-"));
afterAll(() => rm(scratch, { recursive: true, force: true }));

async function shell(version: string, plugin: PublishedPluginName = "desktop") {
  const outDir = join(scratch, plugin, version);
  await generateShell({ plugin, version, outDir, workspaceRoot });
  const read = (path: string) => readFile(join(outDir, path), "utf8");
  return {
    outDir,
    read,
    json: async (path: string) => JSON.parse(await read(path)),
  };
}

describe("generateShell", () => {
  it("pins the bundle package to the plugin version, so the shell builds that release", async () => {
    const { json } = await shell("2.3.0-beta.0");
    const manifest = await json("package.json");
    expect(manifest.dependencies).toEqual({
      [PUBLISHED_PLUGINS.desktop.bundlePackage]: "2.3.0-beta.0",
    });
    expect(manifest.scripts.build).toBe("node scripts/build.mjs");
    expect((await json("manifest.json")).version).toBe("2.3.0-beta.0");
  });

  it("records a stable version's minimum Obsidian version in versions.json", async () => {
    const { json } = await shell("9.9.9");
    const versions = await json("versions.json");
    const { minAppVersion } = await json("manifest.json");
    expect(versions["9.9.9"]).toBe(minAppVersion);
  });

  it("leaves a pre-release out of versions.json, which Obsidian reads for stable installs", async () => {
    const { json } = await shell("9.9.9-beta.0");
    expect(await json("versions.json")).not.toHaveProperty("9.9.9-beta.0");
  });

  it("points the README's images at the source repository, since the shell carries no assets", async () => {
    const { read } = await shell("2.3.0");
    const readme = await read("README.md");
    expect(readme).not.toMatch(/(src|srcset)="assets\//);
    expect(readme).toContain(
      'src="https://raw.githubusercontent.com/aidenlx/zotlit-repo/main/assets/logo/',
    );
    expect(readme).toContain("## About this repository");
  });

  it("names ZotLit's resources and changelog in ZotLit's release workflow", async () => {
    const { read } = await shell("2.3.0");
    const workflow = await read(".github/workflows/plugin-release.yml");
    expect(workflow).toContain(
      "Language Packs, template data JSON Schemas, and the Item Query Schema.",
    );
    expect(workflow).toContain("https://zotlit.aidenlx.site/changelog/");
  });

  it("builds the Reader's shell from the Reader's README, manifest and bundle package", async () => {
    const { read, json } = await shell("1.0.0-beta.0", "reader");
    const manifest = await json("manifest.json");
    expect(manifest).toMatchObject({
      id: "zotlit-reader",
      isDesktopOnly: true,
      version: "1.0.0-beta.0",
    });
    expect((await json("package.json")).dependencies).toEqual({
      "@zotlit/reader-plugin": "1.0.0-beta.0",
    });
    const readme = await read("README.md");
    expect(readme).toMatch(/^# ZotLit Reader\n/);
    expect(readme).toContain("## About this repository");
    const workflow = await read(".github/workflows/plugin-release.yml");
    expect(workflow).toContain(
      '"${{ steps.meta.outputs.resources }}"/* --clobber',
    );
    expect(workflow).toContain("Language Packs.");
    expect(workflow).not.toContain("Item Query Schema");
    expect(workflow).not.toContain("zotlit.aidenlx.site");
    await expect(read("giscus.json")).rejects.toThrow();
  });

  it("builds the Resource Pack's shell as a plain copy of the bundle package's main.js", async () => {
    const { outDir, read, json } = await shell("1.0.0-beta.0", "resources");
    expect(await json("manifest.json")).toMatchObject({
      id: "zotlit-resources",
      isDesktopOnly: false,
      version: "1.0.0-beta.0",
    });
    const manifest = await json("package.json");
    expect(manifest.dependencies).toEqual({
      "@zotlit/resources-plugin": "1.0.0-beta.0",
    });
    expect(manifest.devDependencies).toBeUndefined();
    expect(manifest.scripts.build).toBe("node scripts/build.mjs");
    const container = Buffer.from(
      "/*index*/\nmodule.exports = class {};\n/*\r\nAGFzbQ==\n*/\n//# sourceMappingURL=x",
    );
    const bundle = join(outDir, "node_modules/@zotlit/resources-plugin");
    await mkdir(bundle, { recursive: true });
    await writeFile(
      join(bundle, "package.json"),
      JSON.stringify({
        name: "@zotlit/resources-plugin",
        exports: { "./main.js": "./main.js" },
      }),
    );
    await writeFile(join(bundle, "main.js"), container);
    await promisify(execFile)(process.execPath, ["scripts/build.mjs"], {
      cwd: outDir,
    });
    const [built] = await compareBuilds(bundle, outDir, ["main.js"]);
    expect(built?.shell).toBe(
      createHash("sha256").update(container).digest("hex"),
    );
    expect(await read("pnpm-workspace.yaml")).not.toContain("rolldown");
    await expect(read("src/main.ts")).rejects.toThrow();
    await expect(read("tsconfig.json")).rejects.toThrow();
    expect(await read(".gitignore")).not.toContain("styles.css");

    const readme = await read("README.md");
    expect(readme).toMatch(/^# ZotLit Resource Pack\n/);
    expect(readme).toContain("## About this repository");
    expect(readme).not.toContain("Resource Release");
    expect(readme).not.toContain("styles.css");
  });

  it("gives the Resource Pack a release workflow with no Resource Release, on the same Obsidian action", async () => {
    const pack = await (
      await shell("1.0.0-beta.0", "resources")
    ).read(".github/workflows/plugin-release.yml");
    const reader = await (
      await shell("1.0.0-beta.0", "reader")
    ).read(".github/workflows/plugin-release.yml");
    expect(pack).not.toContain("res-");
    expect(pack).not.toContain("@@");
    expect(pack).toContain("gh release edit");
    const action = /uses: obsidianmd\/obsidian-workflows@\S+/;
    expect(pack.match(action)?.[0]).toBeDefined();
    expect(pack.match(action)?.[0]).toBe(reader.match(action)?.[0]);
  });
});
