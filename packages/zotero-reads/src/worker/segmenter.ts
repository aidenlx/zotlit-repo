import type { SegmenterBinary } from "#contract/rpc.ts";
// The Chinese Segmenter in the worker: the reader the Item Index loads the binary of the Resource Pack through.
import { Effect, Layer } from "effect";

import { SegmenterBinaryReader } from "@zotlit/item-lookup";

/**
 * Reads and verifies the bytes of the Chinese Segmenter binary of a pack; a
 * pack that gives no binary fails with the reason.
 */
export type ReadSegmenter = (typeof SegmenterBinaryReader)["Service"]["read"];

/** No pack reader: every pack reads as unreadable. */
const noPackReader: ReadSegmenter = ({ entry }: SegmenterBinary) =>
  Effect.fail({
    kind: "pack-unreadable",
    detail: `No reader gives the Pack Entry ${entry}`,
  } as const);

/**
 * The {@link SegmenterBinaryReader} over `read`. Without `read` every pack
 * reads as unreadable.
 */
export const layerSegmenterBinaryReader = (
  read: ReadSegmenter = noPackReader,
): Layer.Layer<SegmenterBinaryReader> =>
  Layer.succeed(SegmenterBinaryReader, {
    read,
  });
