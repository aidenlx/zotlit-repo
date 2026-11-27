#!/usr/bin/env node

import type { PublishedPlugin } from "#shell/plugins";
import { join } from "node:path";
import { $ } from "zx";

import { bundleFile, checkBundle, checkBundleRuntime } from "#bundle-gate";
import { getWorkspaceRoot } from "#package-roots";
import { MOBILE_HOST_BUNDLE, PUBLISHED_PLUGINS } from "#shell/plugins";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const plugins = Object.entries<PublishedPlugin>(PUBLISHED_PLUGINS).map(
  ([name, plugin]) => ({ name, plugin }),
);

await $({
  cwd: workspaceRoot,
  stdio: "inherit",
})`pnpm exec turbo run build build:mobile ${plugins.map(({ plugin }) => `--filter=./${plugin.app}`)} --concurrency=2`;

const reports = [
  ...(await Promise.all(
    plugins.map(({ name, plugin }) =>
      checkBundle(name, plugin, join(workspaceRoot, plugin.app)),
    ),
  )),
  checkBundleRuntime(
    "mobile host",
    await bundleFile(
      join(workspaceRoot, MOBILE_HOST_BUNDLE.app, MOBILE_HOST_BUNDLE.file),
    ),
    MOBILE_HOST_BUNDLE.runtime,
  ),
];

let failed = false;
for (const report of reports) {
  console.log(`${report.name}: ${report.lines.join("; ")}`);
  for (const failure of report.failures) {
    console.error(`  ✖ ${failure}`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
