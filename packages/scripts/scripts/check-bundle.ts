#!/usr/bin/env node

import type { PublishedPlugin } from "#shell/plugins";
import { join } from "node:path";
import { $ } from "zx";

import { checkBundle } from "#bundle-gate";
import { getWorkspaceRoot } from "#package-roots";
import { PUBLISHED_PLUGINS } from "#shell/plugins";

const root = await getWorkspaceRoot(import.meta.dirname);
const plugins = Object.entries<PublishedPlugin>(PUBLISHED_PLUGINS).map(
  ([name, plugin]) => ({ name, plugin }),
);

await $({
  cwd: root,
  stdio: "inherit",
})`pnpm exec turbo run build ${plugins.map(({ plugin }) => `--filter=./${plugin.app}`)} --concurrency=2`;

let failed = false;
for (const { name, plugin } of plugins) {
  const report = await checkBundle(name, plugin, join(root, plugin.app));
  console.log(`${report.name}: ${report.lines.join("; ")}`);
  for (const failure of report.failures) {
    console.error(`  ✖ ${failure}`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
