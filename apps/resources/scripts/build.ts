#!/usr/bin/env node
// Builds the Resource Pack plugin: `main.js`, the pack container, and
// `manifest.json`. The production build writes `dist/` and the bundle package
// in `dist/package/`; `--mode development` writes `dist-dev/` and copies it
// into this worktree's Development Vault.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { parsePackPins } from "@zotlit/resource-pack/pins.ts";
import { DEV_VAULT_CASE_ENV, getDevVaultDir } from "@zotlit/scripts/dev-vault";
import { parseManifest } from "@zotlit/scripts/obsidian-manifest";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";
import {
  buildContainerFromBundlePackage,
  deriveDevVersion,
} from "@zotlit/scripts/shell/host-build";
import {
  BUNDLE_PACKAGE_DIR,
  PUBLISHED_PLUGINS,
} from "@zotlit/scripts/shell/plugins";

import { buildResourcePack } from "./pack.ts";

const OUT_DIR = { production: "dist", development: "dist-dev" } as const;

const options = await yargs(hideBin(process.argv))
  .usage(
    "build: the Resource Pack plugin, main.js (the pack container) and manifest.json",
  )
  .option("mode", {
    describe: "the build to write",
    choices: ["production", "development"] as const,
    default: "production" as const,
  })
  .epilogue(
    [
      `production writes ${OUT_DIR.production}/, which pnpm check:bundle reads, and the bundle package`,
      `in ${BUNDLE_PACKAGE_DIR}/, which pnpm release:publish resources packs for npm.`,
      `development writes ${OUT_DIR.development}/ with a dev version in the manifest, and copies it`,
      `into this worktree's Development Vault; ${DEV_VAULT_CASE_ENV}=<case> selects a Vault Case vault.`,
      "Each Pack Entry comes from its installed upstream package and must equal its pin",
      "in package.json (packEntries): the package version and the SHA-256 of the binary.",
    ].join("\n"),
  )
  .strict()
  .parse();
const isDev = options.mode === "development";

const packageRoot = resolve(import.meta.dirname, "..");
const outDir = join(packageRoot, OUT_DIR[options.mode]);
const packageJson = JSON.parse(
  await readFile(join(packageRoot, "package.json"), "utf8"),
);

const pack = await buildResourcePack({
  pins: parsePackPins(packageJson),
  jiebaWasm: join(packageRoot, "node_modules", "jieba-wasm"),
  pandocWasm: join(packageRoot, "node_modules", "pandoc-wasm"),
});
const manifest = parseManifest(packageJson);
if (isDev) manifest.version = deriveDevVersion(manifest.version);

if (isDev) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "main.js"), pack);
} else {
  await buildContainerFromBundlePackage(
    {
      packageRoot,
      workspaceRoot: await getWorkspaceRoot(packageRoot),
      plugin: PUBLISHED_PLUGINS.resources,
      main: pack,
    },
    packageJson,
  );
}
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
