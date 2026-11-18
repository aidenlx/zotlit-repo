import type { SegmenterBinary } from "#contract/rpc.ts";
// The Chinese Segmenter in the worker: the reader the Item Index loads an installed binary through.
import { Effect, Layer } from "effect";

import {
  SegmenterBinaryReader,
  SegmenterUnavailable,
} from "@zotlit/item-lookup";

/** Reads the bytes of an installed Chinese Segmenter binary. */
export type ReadSegmenter = (
  binary: SegmenterBinary,
) => Effect.Effect<BufferSource, SegmenterUnavailable>;

/** No store: every binary reads as unavailable. */
const noStore: ReadSegmenter = ({ name }) =>
  Effect.fail(
    new SegmenterUnavailable({
      message: `No store holds the Chinese Segmenter binary ${name}`,
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
