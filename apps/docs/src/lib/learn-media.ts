import { existsSync, globSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { normalizePath } from "vite";

import type { MediaSize, StoredVideo } from "./media-store.ts";
import { scanVideos } from "./media-store.ts";

export interface StepMedia extends MediaSize {
  poster?: MediaSize;
  clip?: {
    size: MediaSize;
  };
}

export type LearnMedia = Record<string, StepMedia>;

const learnDir = "public/img/learn";

export function webpSize(bytes: Uint8Array): MediaSize | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length));
  if (bytes.length < 30 || text(0, 4) !== "RIFF" || text(8, 4) !== "WEBP") {
    return undefined;
  }
  switch (text(12, 4)) {
    case "VP8 ":
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    case "VP8L": {
      const bits = view.getUint32(21, true);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    case "VP8X": {
      const read24 = (at: number) =>
        bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
      return { width: read24(24) + 1, height: read24(27) + 1 };
    }
    default:
      return undefined;
  }
}

export function scanLearnMedia(
  packageRoot: string,
  videos: readonly StoredVideo[] = scanVideos(packageRoot),
): LearnMedia {
  const clips = new Map(videos.map((video) => [video.path, video]));
  const root = resolve(packageRoot, learnDir);
  if (!existsSync(root)) return {};

  const media: LearnMedia = {};
  const stills = globSync("*/step-*.webp", { cwd: root })
    .map(normalizePath)
    .filter((file) => /\/step-\d+\.webp$/.test(file))
    .toSorted();
  for (const file of stills) {
    const key = file.replace(/\.webp$/, "");
    const size = webpSize(readFileSync(join(root, file)));
    if (!size) continue;

    const clip = clips.get(`/img/learn/${key}.mp4`);
    const posterPath = join(root, `${key}.poster.webp`);
    const poster = existsSync(posterPath)
      ? webpSize(readFileSync(posterPath))
      : undefined;

    media[key] = {
      ...size,
      ...(poster && { poster }),
      ...(clip && { clip: { size: clip.size ?? size } }),
    };
  }
  return media;
}

export function learnMediaPlugin(
  packageRoot: string,
  videos: () => readonly StoredVideo[] = () => scanVideos(packageRoot),
): Plugin {
  const inventory = (scan: readonly StoredVideo[]) =>
    JSON.stringify(scanLearnMedia(packageRoot, scan));
  const mediaRoot = `${normalizePath(resolve(packageRoot, learnDir))}/`;
  return {
    name: "zotlit:learn-media",
    config() {
      return { define: { __LEARN_MEDIA__: inventory(videos()) } };
    },
    configureServer(server) {
      async function refresh(path: string) {
        if (!normalizePath(path).startsWith(mediaRoot)) return;
        const fresh = inventory(scanVideos(packageRoot));
        if (server.config.define?.__LEARN_MEDIA__ !== fresh) {
          await server.restart();
        }
      }
      server.watcher
        .on("add", (path) => void refresh(path))
        .on("change", (path) => void refresh(path))
        .on("unlink", (path) => void refresh(path));
    },
  };
}
