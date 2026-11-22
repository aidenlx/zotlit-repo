import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "zx";

import type { BuiltFileName } from "./profiles.ts";

export interface BuiltFile {
  file: BuiltFileName;
  app: string;
  shell: string;
}

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

export function describeBuilds(files: readonly BuiltFile[]): string {
  return files
    .map(({ file, app, shell }) =>
      app === shell
        ? `same  ${file}  ${app}`
        : `DIFFERENT  ${file}  ${app} / shell ${shell}`,
    )
    .join("\n");
}
