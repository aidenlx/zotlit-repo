import { Effect } from "effect";

import { fetchRange } from "@zotlit/resource-pack/fetch-range.ts";
import { readPackEntry } from "@zotlit/resource-pack/reader.ts";
import type { ReadRange } from "@zotlit/resource-pack/reader.ts";
import type { ReadSegmenter } from "@zotlit/zotero-reads/worker/segmenter.ts";

export const readSegmenterOver = (
  open: (url: string) => ReadRange,
): ReadSegmenter =>
  Effect.fn("readSegmenterOver")(function* ({ url, entry }) {
    const read = yield* Effect.promise(() => readPackEntry(open(url), entry));
    return read.ok
      ? { bytes: read.bytes, upstreamVersion: read.upstreamVersion }
      : yield* Effect.fail(read.failure);
  });

export const readSegmenterFromPack: ReadSegmenter =
  readSegmenterOver(fetchRange);
