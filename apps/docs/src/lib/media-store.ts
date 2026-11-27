import { createHash } from "node:crypto";
import { globSync, readFileSync, rmSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { Plugin } from "vite";
import { loadEnv, normalizePath } from "vite";

export const mediaBucket = "zotlit-docs-media";

export const mediaCacheControl = "public, max-age=31536000, immutable";

export const mediaContentType = "video/mp4";

export interface MediaSize {
  width: number;
  height: number;
}

export interface StoredVideo {
  path: string;
  file: string;
  key: string;
  size?: MediaSize;
}

const imgDir = "public/img";
const videoPatterns = ["learn/*/step-*.mp4", "landing/*.mp4"];

export function isVideoBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length > 1024 &&
    !String.fromCharCode(...bytes.subarray(0, 7)).startsWith("version")
  );
}

export function mp4Size(bytes: Uint8Array): MediaSize | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tkhd = [0x74, 0x6b, 0x68, 0x64];
  for (let at = 4; at + 4 <= bytes.length; at++) {
    if (tkhd.some((byte, i) => bytes[at + i] !== byte)) continue;
    const body = at + 4;
    const sizeAt = body + (bytes[body] === 1 ? 88 : 76);
    if (sizeAt + 8 > bytes.length) return undefined;
    const width = view.getUint32(sizeAt) >>> 16;
    const height = view.getUint32(sizeAt + 4) >>> 16;
    if (width > 0 && height > 0) return { width, height };
  }
  return undefined;
}

export function scanVideos(packageRoot: string): StoredVideo[] {
  const root = resolve(packageRoot, imgDir);
  return globSync(videoPatterns, { cwd: root })
    .map(normalizePath)
    .toSorted()
    .flatMap((rel): StoredVideo[] => {
      const file = join(root, rel);
      const bytes = readFileSync(file);
      if (!isVideoBytes(bytes)) return [];
      const ext = extname(rel);
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
      const size = mp4Size(bytes);
      return [
        {
          path: `/img/${rel}`,
          file,
          key: `${rel.slice(0, -ext.length)}.${hash}${ext}`,
          ...(size && { size }),
        },
      ];
    });
}

export function mediaUrls(
  videos: readonly StoredVideo[],
  origin: string,
): Record<string, string> {
  return Object.fromEntries(videos.map((v) => [v.path, `${origin}/${v.key}`]));
}

export type SignedFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface UploadResult {
  key: string;
  state: "present" | "uploaded" | "missing";
}

export async function uploadMissing(
  videos: readonly StoredVideo[],
  {
    fetch,
    accountId,
    dryRun,
  }: { fetch: SignedFetch; accountId: string; dryRun: boolean },
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  for (const { key, file } of videos) {
    const url = `https://${accountId}.r2.cloudflarestorage.com/${mediaBucket}/${key}`;
    const head = await fetch(url, { method: "HEAD" });
    if (head.ok) {
      results.push({ key, state: "present" });
      continue;
    }
    if (head.status !== 404) {
      throw new Error(`HEAD ${key} answered ${head.status}.`);
    }
    if (dryRun) {
      results.push({ key, state: "missing" });
      continue;
    }
    const put = await fetch(url, {
      method: "PUT",
      body: readFileSync(file),
      headers: {
        "Content-Type": mediaContentType,
        "Cache-Control": mediaCacheControl,
      },
    });
    if (!put.ok) {
      throw new Error(`PUT ${key} answered ${put.status}: ${await put.text()}`);
    }
    results.push({ key, state: "uploaded" });
  }
  return results;
}

export function mediaStorePlugin(
  packageRoot: string,
  videos: () => readonly StoredVideo[] = () => scanVideos(packageRoot),
): Plugin {
  let stored: readonly StoredVideo[] = [];
  return {
    name: "zotlit:media-store",
    config(_config, { command, mode }) {
      const origin =
        command === "build"
          ? loadEnv(mode, packageRoot, "VITE_MEDIA_ORIGIN").VITE_MEDIA_ORIGIN
          : undefined;
      stored = origin ? videos() : [];
      const urls = origin ? mediaUrls(stored, origin) : {};
      return { define: { __MEDIA_URLS__: JSON.stringify(urls) } };
    },
    writeBundle(options) {
      if (this.environment.name !== "client") return;
      for (const video of stored) rmSync(join(options.dir!, video.path));
    },
  };
}
