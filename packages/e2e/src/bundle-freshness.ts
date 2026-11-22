import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface BundleInput {
  path: string;
  mtimeMs: number;
}

const OUTSIDE_BUNDLE = /\.(?:test|bench)\.[cm]?[jt]sx?$/;

export function newerInput(
  bundleMtimeMs: number,
  inputs: Iterable<BundleInput>,
): BundleInput | undefined {
  let newest: BundleInput | undefined;
  for (const input of inputs) {
    if (OUTSIDE_BUNDLE.test(input.path)) continue;
    if (input.mtimeMs <= bundleMtimeMs) continue;
    if (!newest || input.mtimeMs > newest.mtimeMs) newest = input;
  }
  return newest;
}

async function bundledPackageDirs(appDir: string): Promise<string[]> {
  const found = new Set<string>();
  const visit = async (dir: string): Promise<void> => {
    const manifest = JSON.parse(
      await readFile(join(dir, "package.json"), "utf-8"),
    ) as { dependencies?: Record<string, string> };
    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
      if (!version.startsWith("workspace:")) continue;
      const depDir = await realpath(join(dir, "node_modules", name));
      if (found.has(depDir)) continue;
      found.add(depDir);
      await visit(depDir);
    }
  };
  await visit(appDir);
  return [...found];
}

async function readBundleInputs(
  workspaceRoot: string,
  appDir: string,
): Promise<BundleInput[]> {
  return gitInputs(workspaceRoot, [
    join(appDir, "src"),
    join(appDir, "package.json"),
    join(appDir, "vite.config.ts"),
    join(workspaceRoot, "messages"),
    join(workspaceRoot, "project.inlang", "settings.json"),
    join(workspaceRoot, "assets", "logo"),
    ...(await bundledPackageDirs(appDir)).map((dir) => join(dir, "src")),
  ]);
}

export async function gitInputs(
  workspaceRoot: string,
  paths: readonly string[],
): Promise<BundleInput[]> {
  const pathspecs = paths.map((path) => relative(workspaceRoot, path));
  const { stdout } = await execFileAsync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...pathspecs,
    ],
    { cwd: workspaceRoot, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  );
  const files = [...new Set(stdout.split("\0").filter(Boolean))];
  const inputs = await Promise.all(
    files.map(async (path) => {
      const stats = await stat(join(workspaceRoot, path)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        },
      );
      return stats && { path, mtimeMs: stats.mtimeMs };
    }),
  );
  return inputs.filter((input) => input !== undefined);
}

export async function assertDevBundleFresh(
  workspaceRoot: string,
  app: string,
): Promise<void> {
  const appDir = join(workspaceRoot, app);
  const { name } = JSON.parse(
    await readFile(join(appDir, "package.json"), "utf-8"),
  ) as { name: string };
  const rebuild = `pnpm exec turbo run build:dev --filter=${name}`;
  const bundlePath = join(appDir, "dist-dev", "main.js");
  const bundle = await stat(bundlePath).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (!bundle) {
    throw new Error(
      `No dev plugin bundle at ${relative(workspaceRoot, bundlePath)}. Build it:\n  ${rebuild}`,
    );
  }
  const newer = newerInput(
    bundle.mtimeMs,
    await readBundleInputs(workspaceRoot, appDir),
  );
  if (newer) {
    throw new Error(
      `The dev plugin bundle ${relative(workspaceRoot, bundlePath)} is older than ${newer.path}. Rebuild it:\n  ${rebuild}`,
    );
  }
}
