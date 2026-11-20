#!/usr/bin/env zx

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
// only for the type checker
import type {} from "zx/globals";

$.verbose = true;

// path to the primary worktree; wt itself copies gitignored files matched by
// .worktreeinclude when creating the worktree
const primary = argv._[0];

if (primary) {
  await $`pnpm install --frozen-lockfile --prefer-offline`;
} else {
  await $`pnpm install --frozen-lockfile`;
}

// Workspace packages export their TypeScript source, so nothing builds here.
// Turbo generates these files before each task that reads them; generating
// them now gives the editor the plugin's message facade and the Workbench
// message contract. The docs Vite lifecycle generates its collections and
// messages during dev/build.
await $`turbo run generate:language-packs generate:message-types`;

const obsidianRuntime = "1.15.1";
const asarDirs: Record<string, string[]> = {
  darwin: [
    join(homedir(), "Library/Application Support/obsidian"),
    "/Applications/Obsidian.app/Contents/Resources",
  ],
  linux: [join(homedir(), ".config/obsidian")],
  win32: [join(process.env.APPDATA ?? "", "obsidian")],
};
const skill = ".agents/skills/obsidian-asar-extract";
let runtimeAsar: string | undefined;
for (const dir of asarDirs[process.platform] ?? []) {
  for (const name of [`obsidian-${obsidianRuntime}.asar`, "obsidian.asar"]) {
    const file = join(dir, name);
    if (runtimeAsar || !existsSync(file)) continue;
    const probe = await $`node ${skill}/probe-version.mjs --asar ${file}`
      .nothrow()
      .quiet();
    if (probe.stdout.trim() === obsidianRuntime) runtimeAsar = file;
  }
}
if (runtimeAsar) {
  await $`node ${skill}/extract.mjs --asar ${runtimeAsar}`;
} else {
  console.warn(
    `warning: no installed Obsidian ${obsidianRuntime} archive found; the Electron tests of packages/pdf-reader and packages/annotations need node_modules/.ob-rev-${obsidianRuntime}/. Install Obsidian ${obsidianRuntime}, then run: mise run init`,
  );
}
