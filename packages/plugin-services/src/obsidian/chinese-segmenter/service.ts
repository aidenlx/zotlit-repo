// The Chinese Segmenter in the renderer: where the web-target `jieba-wasm`
// binary of the Resource Pack stands in the ZoteroReads worker, which reads
// the binary and cuts with it.

import type { ResourcePackPorts } from "#obsidian/managed-binary/pack-platform.ts";
import type { PackStatusApi } from "#obsidian/managed-binary/pack-status.ts";
import { Context, Effect, Layer, Stream } from "effect";

import type { SegmenterBinary } from "@zotlit/item-lookup";
import type { PackBinaryStatus } from "@zotlit/resource-pack/status.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { ResourcePackPlatform } from "#obsidian/managed-binary/pack-platform.ts";
import { makePackStatus } from "#obsidian/managed-binary/pack-status.ts";

/** The name of the Chinese Segmenter's Pack Entry. */
const SEGMENTER_ENTRY = "chinese-segmenter";

/**
 * The Chinese Segmenter's entry in the pack that `platform` finds installed,
 * which the worker reads; `null` with no pack installed.
 */
export const segmenterBinaryOf = (
  platform: Pick<ResourcePackPorts, "locate">,
): Effect.Effect<SegmenterBinary | null> =>
  Effect.map(
    platform.locate,
    (location) => location && { ...location, entry: SEGMENTER_ENTRY },
  );

/**
 * The status of the Chinese Segmenter that search runs. This thread locates
 * the pack; the worker reads the binary, starts it and states where it
 * stands. `check` asks the worker for a new read, and waits for a worker
 * that still starts; with no pack installed, the worker stops the binary. A
 * worker that does not answer reads as `failed` for an installed pack. The
 * service asks again after each change of the pack, and when the reads serve
 * again after a worker stopped.
 */
export class ChineseSegmenter extends Context.Service<
  ChineseSegmenter,
  PackStatusApi
>()("zotlit/chinese-segmenter/ChineseSegmenter") {}

export const layerChineseSegmenter = Layer.effect(
  ChineseSegmenter,
  Effect.gen(function* () {
    const platform = yield* ResourcePackPlatform;
    const zoteroReads = yield* ZoteroReads;
    const { check, checkChanged, current, changes } = yield* makePackStatus(
      Effect.gen(function* () {
        const binary = yield* segmenterBinaryOf(platform);
        return yield* zoteroReads.reads
          .CheckChineseSegmenter({ binary })
          .pipe(
            Effect.catch((error) =>
              Effect.succeed<PackBinaryStatus>(
                binary
                  ? { kind: "failed", detail: error.message }
                  : { kind: "pack-absent" },
              ),
            ),
          );
      }),
    );
    // Each watcher learns where the Segmenter stands in the pack that is
    // there now.
    yield* platform.changes.pipe(
      Stream.runForEach(() => checkChanged),
      Effect.forkScoped({ startImmediately: true }),
    );
    // A status is that of one worker. A worker that stops leaves the reads
    // degraded, and the worker that serves next starts the binary again from
    // its spawn settings: its status is asked once the reads serve again.
    let degraded = false;
    yield* zoteroReads.changes.pipe(
      Stream.runForEach(({ state }) =>
        Effect.suspend(() => {
          const servesAgain = degraded && state !== "degraded";
          degraded = state === "degraded";
          return servesAgain ? checkChanged : Effect.void;
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    );
    return { check, current, changes };
  }),
);
