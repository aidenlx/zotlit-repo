import type { SegmenterBinary } from "#contract/rpc.ts";
// The Chinese Segmenter in the worker: the reader the Item Index loads the binary of the Resource Pack through.
import { Effect, Layer } from "effect";

import {
  SegmenterBinaryReader,
  SegmenterUnavailable,
} from "@zotlit/item-lookup";

/** Reads and verifies the bytes of the Chinese Segmenter binary of a pack. */
export type ReadSegmenter = (
  binary: SegmenterBinary,
) => Effect.Effect<BufferSource, SegmenterUnavailable>;

/** No pack reader: every binary reads as unavailable. */
const noStore: ReadSegmenter = ({ entry }) =>
  Effect.fail(
    new SegmenterUnavailable({
      message: `No reader gives the Pack Entry ${entry}`,
    }),
  );

/**
 * The {@link SegmenterBinaryReader} over `read`; a failed read carries
 * {@link SegmenterUnavailable}. Without `read` every binary reads as
 * unavailable.
 */
export const layerSegmenterBinaryReader = (
  read: ReadSegmenter = noStore,
): Layer.Layer<SegmenterBinaryReader> =>
  Layer.succeed(SegmenterBinaryReader, {
    read,
  });
