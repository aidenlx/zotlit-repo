// The Chinese Segmenter in the renderer: where the web-target `jieba-wasm`
// binary of the Resource Pack stands in the ZoteroReads worker, which reads
// the binary and cuts with it.

import type { PackStatusApi } from "#obsidian/managed-binary/pack-status.ts";
import { Context, Effect, Layer, Stream } from "effect";

import type { SegmenterBinary } from "@zotlit/item-lookup";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { ResourcePackPlatform } from "#obsidian/managed-binary/pack-platform.ts";
import { makePackStatus } from "#obsidian/managed-binary/pack-status.ts";

/** The name of the Chinese Segmenter's Pack Entry. */
const SEGMENTER_ENTRY = "chinese-segmenter";

/**
 * The Chinese Segmenter's entry in the installed pack, which the worker
 * reads; `null` with no pack installed.
 */
export const segmenterBinary: Effect.Effect<
  SegmenterBinary | null,
  never,
  ResourcePackPlatform
> = Effect.gen(function* () {
  const location = yield* (yield* ResourcePackPlatform).locate;
  return location && { ...location, entry: SEGMENTER_ENTRY };
});

/**
 * The status of the Chinese Segmenter that search runs. This thread locates
 * the pack; the worker reads the binary, starts it and states where it
 * stands. `check` asks the worker for a new read, and waits for a worker
 * that still starts; with no pack installed it answers `pack-absent` with no
 * request. A worker that does not answer reads as `failed`.
 */
export class ChineseSegmenter extends Context.Service<
  ChineseSegmenter,
  PackStatusApi
>()("zotlit/chinese-segmenter/ChineseSegmenter") {}

export const layerChineseSegmenter = Layer.effect(
  ChineseSegmenter,
  Effect.gen(function* () {
    const platform = yield* ResourcePackPlatform;
    const { reads } = yield* ZoteroReads;
    const { check, checkChanged, current, changes } = yield* makePackStatus(
      Effect.gen(function* () {
        const binary = yield* segmenterBinary;
        if (!binary) return { kind: "pack-absent" } as const;
        return yield* reads.CheckChineseSegmenter({ binary }).pipe(
          Effect.catch((error) =>
            Effect.succeed({
              kind: "failed",
              detail: error.message,
            } as const),
          ),
        );
      }).pipe(Effect.provideService(ResourcePackPlatform, platform)),
    );
    // Each watcher learns where the Segmenter stands in the pack that is
    // there now.
    yield* platform.changes.pipe(
      Stream.runForEach(() => checkChanged),
      Effect.forkScoped({ startImmediately: true }),
    );
    return { check, current, changes };
  }),
);
