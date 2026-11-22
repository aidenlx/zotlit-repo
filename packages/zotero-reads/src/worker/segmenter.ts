import type { SegmenterBinary } from "#contract/rpc.ts";
import { Effect, Layer } from "effect";

import { SegmenterBinaryReader } from "@zotlit/item-lookup";

export type ReadSegmenter = (typeof SegmenterBinaryReader)["Service"]["read"];

const noPackReader: ReadSegmenter = ({ entry }: SegmenterBinary) =>
  Effect.fail({
    kind: "pack-unreadable",
    detail: `No reader gives the Pack Entry ${entry}`,
  } as const);

export const layerSegmenterBinaryReader = (
  read: ReadSegmenter = noPackReader,
): Layer.Layer<SegmenterBinaryReader> =>
  Layer.succeed(SegmenterBinaryReader, {
    read,
  });
