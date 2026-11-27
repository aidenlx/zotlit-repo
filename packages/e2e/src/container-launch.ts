import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PINNED_ZOTERO_VERSION } from "@zotlit/scripts/fixture/paired-zotero";

import { runImageTag } from "./container-image.ts";
import { OBSIDIAN_VERSION } from "./obsidian-version.ts";

export const IMAGE_ARCHIVE_ENV = "ZOTLIT_E2E_IMAGE_ARCHIVE";

export interface RunImage {
  tag: string;
  platform: string;
  pnpm: string;
  context: string;
}

export function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

export function runImage(workspaceRoot: string): RunImage {
  const context = resolve(workspaceRoot, "packages/e2e/container");
  const { packageManager } = JSON.parse(
    readFileSync(resolve(workspaceRoot, "package.json"), "utf8"),
  ) as { packageManager: string };
  const pnpm = packageManager.slice("pnpm@".length);
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const platform = `linux/${arch}`;
  const tag = runImageTag(context, {
    platform,
    pnpm,
    obsidian: OBSIDIAN_VERSION,
    zotero: PINNED_ZOTERO_VERSION,
  });
  return { tag, platform, pnpm, context };
}

export function worktreeFiles(workspaceRoot: string): string {
  const gitFiles = (args: string[]) =>
    execFileSync("git", ["ls-files", "-z", ...args], {
      cwd: workspaceRoot,
      maxBuffer: 64 * 1024 * 1024,
      encoding: "utf8",
    }).split("\0");
  const deleted = new Set(gitFiles(["--deleted"]));
  return gitFiles([
    "--cached",
    "--others",
    "--exclude-standard",
    "--deduplicate",
  ])
    .filter((path) => !deleted.has(path))
    .map((path) => `${path}\0`)
    .join("");
}

export function ensureImage({ tag, platform, pnpm, context }: RunImage): void {
  const archive = process.env[IMAGE_ARCHIVE_ENV];
  const hasImage = () => docker(["image", "ls", "--quiet", tag]) !== "";
  let available = hasImage();
  let archived = archive !== undefined && existsSync(archive);
  if (!available && archive && archived) {
    execFileSync("docker", ["load", "--input", archive], { stdio: "inherit" });
    available = hasImage();
    archived = available;
  }
  if (!available) {
    execFileSync(
      "docker",
      [
        "build",
        "--platform",
        platform,
        "--tag",
        tag,
        "--build-arg",
        `PNPM_VERSION=${pnpm}`,
        "--build-arg",
        `OBSIDIAN_VERSION=${OBSIDIAN_VERSION}`,
        "--build-arg",
        `ZOTERO_VERSION=${PINNED_ZOTERO_VERSION}`,
        context,
      ],
      { stdio: "inherit" },
    );
  }
  if (archive && !archived) {
    execFileSync("docker", ["save", "--output", archive, tag], {
      stdio: "inherit",
    });
  }
}
