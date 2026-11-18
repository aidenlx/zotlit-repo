#!/usr/bin/env node
// Writes the publish repository's tree for one plugin version.
//   --plugin <name>        a key of PUBLISHED_PLUGINS (default: desktop)
//   --version <version>    the plugin version (default: the host app's)
//   --out <dir>            the folder to write; its old content is removed
//   --bundle-tarball <tgz> lock the bundle package to a local tarball; without
//                          it, pnpm resolves the package from the npm registry,
//                          so the version must be published
//   --no-lock              write no pnpm-lock.yaml
import type { PublishedPluginName } from "#shell/plugins";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { getWorkspaceRoot } from "#package-roots";
import { generateShell, lockShell } from "#shell/generate";
import { PUBLISHED_PLUGINS } from "#shell/plugins";

const { values } = parseArgs({
  options: {
    plugin: { type: "string", default: "desktop" },
    version: { type: "string" },
    out: { type: "string" },
    "bundle-tarball": { type: "string" },
    "no-lock": { type: "boolean", default: false },
  },
});

if (!(values.plugin in PUBLISHED_PLUGINS)) {
  console.error(
    `--plugin must be one of ${Object.keys(PUBLISHED_PLUGINS).join(", ")}.`,
  );
  process.exit(1);
}
if (!values.out) {
  console.error("--out names the folder to write the shell into.");
  process.exit(1);
}
const plugin = values.plugin as PublishedPluginName;
const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const version =
  values.version ??
  (
    JSON.parse(
      await readFile(
        join(workspaceRoot, PUBLISHED_PLUGINS[plugin].app, "package.json"),
        "utf8",
      ),
    ) as { version: string }
  ).version;
const outDir = resolve(values.out);

await generateShell({ plugin, version, outDir, workspaceRoot });
if (!values["no-lock"]) {
  const tarball = values["bundle-tarball"];
  await lockShell(outDir, {
    plugin,
    bundleTarball: tarball === undefined ? undefined : resolve(tarball),
  });
}
console.log(`Wrote the ${plugin} shell for ${version} to ${outDir}.`);
