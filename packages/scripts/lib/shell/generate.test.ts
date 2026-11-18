import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { generateShell } from "./generate.ts";

import { getWorkspaceRoot } from "#package-roots";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const scratch = await mkdtemp(join(tmpdir(), "zt-shell-"));
afterAll(() => rm(scratch, { recursive: true, force: true }));

async function shell(version: string) {
  const outDir = join(scratch, version);
  await generateShell({ plugin: "desktop", version, outDir, workspaceRoot });
  const read = (path: string) => readFile(join(outDir, path), "utf8");
  return {
    read,
    json: async (path: string) => JSON.parse(await read(path)),
  };
}

describe("generateShell", () => {
  it("pins the bundle package to the plugin version, so the shell builds that release", async () => {
    const { json } = await shell("2.3.0-beta.0");
    const manifest = await json("package.json");
    expect(manifest.dependencies).toEqual({
      "@zotlit/obsidian-plugin": "2.3.0-beta.0",
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
});
