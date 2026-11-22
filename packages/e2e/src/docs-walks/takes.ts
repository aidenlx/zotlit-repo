import { regex } from "arkregex";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";

import type { CameraEvent, CameraTrack } from "./camera.ts";
import { cutSettings } from "./clip-settings.ts";
import type { ClipSettings } from "./clip-settings.ts";

const execFileAsync = promisify(execFile);

const RECORDER = [
  "packages/e2e/src/docs-walks/docs-walk.ts",
  "packages/e2e/src/docs-walks/camera.ts",
  "packages/e2e/src/docs-walks/clip-encode.ts",
  "packages/e2e/src/docs-walks/docs-browser.ts",
  "packages/e2e/src/docs-walks/macos-desktop.ts",
  "packages/e2e/src/docs-walks/pointer-look.ts",
];

export interface Take {
  recordedAt: string;
  step: string;
  recipe: { build: string; record: string; recut?: string };
  env: Record<string, string>;
  versionGateBypass: boolean;
  recorder: { commit: string; edited: boolean };
  apps: { obsidian: string; obsidianPin: string; zotero: string };
  vaultCase: string;
  window: { width: number; height: number };
  source: "obsidian-screencast" | "zotero-window" | "sequence";
  frames: string;
  settings: ClipSettings;
  duration: number;
  outputs: Record<string, number>;
  camera?: {
    track: "planned" | "override" | "whole";
    viewport: { width: number; height: number };
    events: CameraEvent[];
    keyframes: CameraTrack["keyframes"];
  };
  shots?: {
    dir: string;
    viewport: { width: number; height: number };
    events: CameraEvent[];
    keyframes: CameraTrack["keyframes"];
  }[];
}

export type TakeRun = Pick<
  Take,
  "env" | "versionGateBypass" | "recorder" | "apps" | "vaultCase" | "window"
>;

export async function takeRun(
  root: string,
  options: {
    slug: string;
    running: string;
    zotero: string;
    vaultCase: string;
    window: { width: number; height: number };
  },
): Promise<TakeRun> {
  const git = async (...args: string[]) =>
    (await execFileAsync("git", ["-C", root, ...args])).stdout.trim();
  const committed = await git(
    "show",
    "HEAD:packages/e2e/src/vault-script.ts",
  ).catch(() => "");
  const pin = regex('OBSIDIAN_VERSION = "([^"]+)"').exec(committed)?.[1] ?? "";
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] =>
        e[0].startsWith("DOCS_WALK_") && e[1] !== undefined,
    ),
  );
  return {
    env,
    versionGateBypass: pin !== options.running,
    recorder: {
      commit: await git("log", "-1", "--format=%H", "--", ...RECORDER),
      edited: (await git("status", "--porcelain", "--", ...RECORDER)) !== "",
    },
    apps: {
      obsidian: options.running,
      obsidianPin: pin,
      zotero: options.zotero,
    },
    vaultCase: options.vaultCase,
    window: options.window,
  };
}

export function takeRecipe(
  root: string,
  options: {
    slug: string;
    name: string;
    out: string;
    frames?: string;
    clip?: Partial<ClipSettings>;
  },
): Take["recipe"] {
  const { slug, name, out, frames } = options;
  const cut = cutSettings(options.clip ?? {});
  const recutEnv =
    Object.keys(cut).length > 0
      ? `DOCS_WALK_CLIP='${JSON.stringify(cut)}' `
      : "";
  return {
    build:
      "pnpm exec turbo run build:dev --filter=@zotlit/obsidian --filter=@zotlit/zotero",
    record: `${process.env.DOCS_WALK_NATIVE === "1" ? "DOCS_WALK_NATIVE=1 " : ""}DOCS_WALK_RECORD=1 DOCS_WALK_ONLY=${name} pnpm --filter @zotlit/e2e docs-walk src/docs-walks/${slug}.walk.ts`,
    ...(frames && {
      recut: `${recutEnv}node packages/e2e/src/docs-walks/clip-encode.ts ${relative(root, frames)} ${relative(root, out)}`,
    }),
  };
}

export async function outputSizes(
  root: string,
  out: string,
): Promise<Record<string, number>> {
  const sizes: Record<string, number> = {};
  for (const ext of ["mp4", "poster.webp"]) {
    const file = `${out}.${ext}`;
    const size = await stat(file).then(
      (s) => s.size,
      () => undefined,
    );
    if (size !== undefined) sizes[relative(root, file)] = size;
  }
  return sizes;
}

export async function videoLength(file: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ]);
  return Math.round(Number(stdout.trim()) * 1000) / 1000;
}

export async function takeRecordFile(
  root: string,
  slug: string,
): Promise<string> {
  const video = join(root, "video");
  return access(join(video, ".git")).then(
    () => join(video, "docs-walks", "takes", `${slug}.takes.json`),
    () => join(root, ".scratch", "docs-walks", slug, "takes.json"),
  );
}

export async function writeTake(
  file: string,
  name: string,
  take: Take,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const takes: Record<string, Take> = await access(file).then(
    async () =>
      JSON.parse(await readFile(file, "utf8")) as Record<string, Take>,
    () => ({}),
  );
  takes[name] = take;
  const sorted = Object.fromEntries(
    Object.entries(takes).toSorted(([a], [b]) =>
      a.localeCompare(b, "en", { numeric: true }),
    ),
  );
  await writeFile(file, `${JSON.stringify(sorted, null, 2)}\n`);
}
