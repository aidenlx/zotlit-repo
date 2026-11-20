#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "zx";

import { checkBundle } from "#bundle-gate";
import { getWorkspaceRoot } from "#package-roots";
import { PUBLISHED_PLUGINS } from "#shell/plugins";

const root = await getWorkspaceRoot(import.meta.dirname);
const plugins = await Promise.all(
  Object.entries(PUBLISHED_PLUGINS).map(async ([name, plugin]) => {
    const { name: packageName } = JSON.parse(
      await readFile(join(root, plugin.app, "package.json"), "utf8"),
    ) as { name: string };
    return { name, plugin, packageName };
  }),
);

await $({
  cwd: root,
  stdio: "inherit",
})`pnpm exec turbo run build ${plugins.map(({ packageName }) => `--filter=${packageName}`)} --concurrency=2`;

let failed = false;
for (const { name, plugin } of plugins) {
  const report = await checkBundle(
    name,
    plugin,
    join(root, plugin.app, "dist"),
  );
  console.log(`${report.name}: ${report.lines.join("; ")}`);
  for (const failure of report.failures) {
    console.error(`  ✖ ${failure}`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
