#!/usr/bin/env node
// Builds the Resource Pack plugin: `main.js`, the pack container, and
// `manifest.json`. The production build writes `dist/`; `--mode development`
// writes `dist-dev/` and copies it into this worktree's Development Vault.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { DEV_VAULT_CASE_ENV, getDevVaultDir } from "@zotlit/scripts/dev-vault";
import { parseManifest } from "@zotlit/scripts/obsidian-manifest";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";
import { deriveDevVersion } from "@zotlit/scripts/shell/host-build";

import type { EntryPins } from "./pack.ts";
import { buildResourcePack } from "./pack.ts";

const { values } = parseArgs({
  options: { mode: { type: "string", default: "production" } },
});
const isDev = values.mode === "development";

const packageRoot = resolve(import.meta.dirname, "..");
const outDir = join(packageRoot, isDev ? "dist-dev" : "dist");
const packageJson = JSON.parse(
  await readFile(join(packageRoot, "package.json"), "utf8"),
) as { packEntries: EntryPins };

const pack = await buildResourcePack({
  pins: packageJson.packEntries,
  jiebaWasm: join(packageRoot, "node_modules", "jieba-wasm"),
});
const manifest = parseManifest(packageJson);
if (isDev) manifest.version = deriveDevVersion(manifest.version);

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "main.js"), pack);
await writeFile(
  join(outDir, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(
  `Resource Pack v${manifest.version}: main.js ${pack.length.toLocaleString("en-US")} B`,
);

if (isDev) {
  const vaultPluginDir = join(
    getDevVaultDir(
      await getWorkspaceRoot(packageRoot),
      process.env[DEV_VAULT_CASE_ENV],
    ),
    ".obsidian",
    "plugins",
    manifest.id,
  );
  await mkdir(vaultPluginDir, { recursive: true });
  await cp(outDir, vaultPluginDir, { recursive: true });
  console.log(`Copied to dev vault: ${vaultPluginDir}`);
}
