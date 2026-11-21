// The proof that a shell builds the plugin the host app released: install the
// shell from its lockfile, run its `build` script as the official Obsidian
// release action does, and compare the result with the host app's build byte
// for byte. `pnpm release:check-shell` runs it on a shell locked to a local
// tarball, and `pnpm release:publish` on a copy of the shell it commits.
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "zx";

import type { PublishedPlugin } from "./plugins.ts";

type BuiltFileName = "main.js" | "styles.css";

/**
 * The files the shell's build writes and the release uploads. A Resource
 * Pack has no stylesheet.
 */
export function builtFiles(plugin: PublishedPlugin): readonly BuiltFileName[] {
  return plugin.container ? ["main.js"] : ["main.js", "styles.css"];
}

export interface BuiltFile {
  file: BuiltFileName;
  /** sha256 of the host app's file. */
  app: string;
  /** sha256 of the shell's file. */
  shell: string;
}

/**
 * Runs `pnpm install --frozen-lockfile` and `npm run build` in `dir`. With
 * `npmrc`, that `.npmrc` is in place for the install, and removed after it.
 */
export async function installAndBuild(
  dir: string,
  options: { npmrc?: string } = {},
): Promise<void> {
  const inShell = $({ cwd: dir, stdio: "inherit" });
  const npmrc = join(dir, ".npmrc");
  if (options.npmrc) await writeFile(npmrc, options.npmrc);
  try {
    await inShell`pnpm install --frozen-lockfile`;
  } finally {
    if (options.npmrc) await rm(npmrc, { force: true });
  }
  await inShell`npm run build`;
}

const sha256 = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

/** The hashes of each of `files` in `appDist` and in `shellDir`. */
export async function compareBuilds(
  appDist: string,
  shellDir: string,
  files: readonly BuiltFileName[],
): Promise<BuiltFile[]> {
  return Promise.all(
    files.map(async (file) => ({
      file,
      app: await sha256(join(appDist, file)),
      shell: await sha256(join(shellDir, file)),
    })),
  );
}

/** One line per file, `same` or `DIFFERENT`, for a log. */
export function describeBuilds(files: readonly BuiltFile[]): string {
  return files
    .map(({ file, app, shell }) =>
      app === shell
        ? `same  ${file}  ${app}`
        : `DIFFERENT  ${file}  ${app} / shell ${shell}`,
    )
    .join("\n");
}
