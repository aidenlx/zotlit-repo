#!/usr/bin/env node
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

const { values } = parseArgs({ options: { plugin: { type: "string" } } });
const names = (
  values.plugin === undefined ? Object.keys(PUBLISHED_PLUGINS) : [values.plugin]
) as PublishedPluginName[];
for (const name of names) {
  if (!(name in PUBLISHED_PLUGINS)) {
    console.error(
      `--plugin must be one of ${Object.keys(PUBLISHED_PLUGINS).join(", ")}.`,
    );
    process.exit(2);
  }
}
const root = await getWorkspaceRoot(import.meta.dirname);
const sh = $({ cwd: root, stdio: "inherit" });

const failed: PublishedPluginName[] = [];
for (const name of names) {
  if (!(await checkShell(name))) failed.push(name);
}
if (failed.length > 0) {
  console.error(`\nThe shell check failed for ${failed.join(", ")}.`);
  process.exit(1);
}

async function checkShell(name: PublishedPluginName): Promise<boolean> {
  const plugin = PUBLISHED_PLUGINS[name];
  const appDir = join(root, plugin.app);
  const bundleDir = join(appDir, BUNDLE_PACKAGE_DIR);
  const checkDir = join(root, ".scratch/shell-check", name);
  const shellDir = join(checkDir, "shell");

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
  const tarball = (await readdir(checkDir)).find((file) =>
    file.endsWith(".tgz"),
  );
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
  const builds = await compareBuilds(
    join(appDir, "dist"),
    shellDir,
    plugin.profile.builtFiles,
  );
  console.log(describeBuilds(builds));
  if (builds.some(({ app, shell }) => app !== shell)) {
    console.error(
      "\nThe shell does not reproduce the host app's build. Compare the two files above.",
    );
    return false;
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
  const manifest = await readFile(join(shellDir, "manifest.json"), "utf8");
  const manifestCheck = await $({
    cwd: root,
    nothrow: true,
    input: manifest,
    stdio: ["pipe", "inherit", "inherit"],
  })`pnpm exec eslint --quiet --stdin --stdin-filename manifest.json`;
  if (manifestCheck.exitCode === 0) console.log("manifest.json passes.");

  if (
    errors > 0 ||
    manifestCheck.exitCode !== 0 ||
    (report.exitCode ?? 2) > 1
  ) {
    console.error("\nThe shell fails the community scanner's checks above.");
    return false;
  }
  console.log(
    `\nThe ${name} shell for ${version} reproduces the release build.\n`,
  );
  return true;
}
