import type { ResourcePackPorts } from "#obsidian/managed-binary/pack-platform.ts";
import type { PackStatusApi } from "#obsidian/managed-binary/pack-status.ts";
import { Context, Effect, Layer, Stream } from "effect";

import type { SegmenterBinary } from "@zotlit/item-lookup";
import type { PackBinaryStatus } from "@zotlit/resource-pack/status.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { ResourcePackPlatform } from "#obsidian/managed-binary/pack-platform.ts";
import { makePackStatus } from "#obsidian/managed-binary/pack-status.ts";

const SEGMENTER_ENTRY = "chinese-segmenter";

export const segmenterBinaryOf = (
  platform: Pick<ResourcePackPorts, "locate">,
): Effect.Effect<SegmenterBinary | null> =>
  Effect.map(
    platform.locate,
    (location) => location && { ...location, entry: SEGMENTER_ENTRY },
  );

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
    yield* platform.changes.pipe(
      Stream.runForEach(() => checkChanged),
      Effect.forkScoped({ startImmediately: true }),
    );
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
