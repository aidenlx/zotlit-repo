#!/usr/bin/env node
// Proves, before anything is published, that the publish repository's shell
// builds the plugin this workspace releases:
//   1. builds the host app; its production build writes the bundle package
//      into dist/package/ and builds dist/main.js from it,
//   2. packs the bundle package with `pnpm pack`,
//   3. generates the shell into .scratch/shell-check/shell/, locked to that
//      tarball in place of the registry version,
//   4. installs the shell from its lockfile and runs its `build` script, as
//      the official Obsidian release action does,
//   5. compares the shell's main.js and styles.css with the host app's, byte
//      for byte,
//   6. runs the community scanner's ESLint config on the shell tree from its
//      root, and the manifest rule on its manifest.json.
// `pnpm verify --release` runs it after the Obsidian guideline review.
import type { PublishedPluginName } from "#shell/plugins";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { $ } from "zx";

import { getWorkspaceRoot } from "#package-roots";
import {
  compareBuilds,
  describeBuilds,
  installAndBuild,
} from "#shell/build-check";
import { generateShell, lockShell } from "#shell/generate";
import { BUNDLE_PACKAGE_DIR, PUBLISHED_PLUGINS } from "#shell/plugins";

const { values } = parseArgs({
  options: { plugin: { type: "string", default: "desktop" } },
});
const name = values.plugin as PublishedPluginName;
const plugin = PUBLISHED_PLUGINS[name];
const root = await getWorkspaceRoot(import.meta.dirname);
const appDir = join(root, plugin.app);
const bundleDir = join(appDir, BUNDLE_PACKAGE_DIR);
const checkDir = join(root, ".scratch/shell-check");
const shellDir = join(checkDir, "shell");
const sh = $({ cwd: root, stdio: "inherit" });

const { name: appName, version } = JSON.parse(
  await readFile(join(appDir, "package.json"), "utf8"),
) as { name: string; version: string };

console.log(`▸ Build ${appName} and its bundle package`);
await sh`pnpm exec turbo run build --filter=${appName}`;

console.log(`\n▸ Pack ${plugin.bundlePackage}@${version}`);
await rm(checkDir, { recursive: true, force: true });
await mkdir(checkDir, { recursive: true });
await $({
  cwd: bundleDir,
  stdio: "inherit",
})`pnpm pack --pack-destination ${checkDir}`;
const tarball = (await readdir(checkDir)).find((file) => file.endsWith(".tgz"));
if (!tarball) throw new Error(`pnpm pack wrote no tarball into ${checkDir}`);

console.log(`\n▸ Generate the shell into ${shellDir}`);
await generateShell({
  plugin: name,
  version,
  outDir: shellDir,
  workspaceRoot: root,
});
await lockShell(shellDir, {
  plugin: name,
  bundleTarball: join(checkDir, tarball),
});

console.log("\n▸ Install and build the shell");
await installAndBuild(shellDir);

console.log("\n▸ Compare with the host app's build");
const builds = await compareBuilds(join(appDir, "dist"), shellDir);
console.log(describeBuilds(builds));
if (builds.some(({ app, shell }) => app !== shell)) {
  console.error(
    "\nThe shell does not reproduce the host app's build. Compare the two files above.",
  );
  process.exit(1);
}

console.log("\n▸ Community scanner ESLint on the shell");
const scannerConfig = join(
  root,
  "packages/scripts/lib/shell/scanner-eslint.config.js",
);
const eslint = join(root, "node_modules/.bin/eslint");
const report = await $({
  cwd: shellDir,
  nothrow: true,
})`${eslint} --config ${scannerConfig} --format json --no-error-on-unmatched-pattern .`;
const results = JSON.parse(report.stdout) as {
  filePath: string;
  messages: {
    ruleId: string | null;
    severity: number;
    message: string;
    line?: number;
  }[];
}[];
let errors = 0;
for (const { filePath, messages } of results) {
  for (const { ruleId, severity, message, line } of messages) {
    if (severity === 2) errors++;
    console.log(
      `${severity === 2 ? "error" : "warn "}  ${filePath.slice(shellDir.length + 1)}:${line ?? 0}  ${ruleId ?? "fatal"}  ${message}`,
    );
  }
}
console.log(
  `Linted ${results.length} file(s): ${results.map(({ filePath }) => filePath.slice(shellDir.length + 1)).join(", ")}; ${errors} error(s).`,
);

console.log("\n▸ Manifest rule on the shell's manifest.json");
// eslint.config.js applies `obsidianmd/validate-manifest` to `manifest.json`,
// as `pnpm review:manifest` does for the manifest the app's package.json makes.
const manifest = await readFile(join(shellDir, "manifest.json"), "utf8");
const manifestCheck = await $({
  cwd: root,
  nothrow: true,
  input: manifest,
  stdio: ["pipe", "inherit", "inherit"],
})`pnpm exec eslint --quiet --stdin --stdin-filename manifest.json`;
if (manifestCheck.exitCode === 0) console.log("manifest.json passes.");

if (errors > 0 || manifestCheck.exitCode !== 0 || (report.exitCode ?? 2) > 1) {
  console.error("\nThe shell fails the community scanner's checks above.");
  process.exit(1);
}
console.log(`\nThe ${name} shell for ${version} reproduces the release build.`);
