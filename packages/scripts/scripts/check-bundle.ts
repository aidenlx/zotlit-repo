#!/usr/bin/env node

import type { PublishedPlugin } from "#shell/plugins";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "zx";

import type { PackPins } from "@zotlit/resource-pack/pins.ts";
import { parsePackPins } from "@zotlit/resource-pack/pins.ts";

import { checkBundle } from "#bundle-gate";
import { getWorkspaceRoot } from "#package-roots";
import { PUBLISHED_PLUGINS } from "#shell/plugins";

const root = await getWorkspaceRoot(import.meta.dirname);
const plugins = Object.entries<PublishedPlugin>(PUBLISHED_PLUGINS).map(
  ([name, plugin]) => ({ name, plugin }),
);

/** The pins a Resource Pack's package.json states for its Pack Entries. */
async function packPins(app: string): Promise<PackPins> {
  return parsePackPins(
    JSON.parse(await readFile(join(root, app, "package.json"), "utf8")),
  );
}

await $({
  cwd: root,
  stdio: "inherit",
})`pnpm exec turbo run build ${plugins.map(({ plugin }) => `--filter=./${plugin.app}`)} --concurrency=2`;

let failed = false;
for (const { name, plugin } of plugins) {
  const report = await checkBundle(name, plugin, {
    distDir: join(root, plugin.app, "dist"),
    packPins: plugin.container ? await packPins(plugin.app) : undefined,
  });
  console.log(`${report.name}: ${report.lines.join("; ")}`);
  for (const failure of report.failures) {
    console.error(`  ✖ ${failure}`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
