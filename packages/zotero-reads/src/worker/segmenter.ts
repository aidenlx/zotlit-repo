import type { SegmenterBinary } from "#contract/rpc.ts";
import { Effect, Layer } from "effect";

import { SegmenterBinaryReader } from "@zotlit/item-lookup";
import { fetchRange } from "@zotlit/resource-pack/fetch-range.ts";
import { readPackEntry } from "@zotlit/resource-pack/reader.ts";
import type { ReadRange } from "@zotlit/resource-pack/reader.ts";

export type ReadSegmenter = (typeof SegmenterBinaryReader)["Service"]["read"];

export const readSegmenterOver = (
  open: (url: string) => ReadRange,
): ReadSegmenter =>
  Effect.fn("readSegmenterOver")(function* ({ url, entry }) {
    const read = yield* Effect.promise(() => readPackEntry(open(url), entry));
    return read.ok
      ? { bytes: read.bytes, upstreamVersion: read.upstreamVersion }
      : yield* Effect.fail(read.failure);
  });

export const readSegmenterFromPack: ReadSegmenter = readSegmenterOver((url) =>
  fetchRange(url),
);

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
