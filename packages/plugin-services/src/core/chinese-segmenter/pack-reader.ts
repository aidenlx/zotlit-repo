// The Worker's read of the Chinese Segmenter binary: its Pack Entry in the
// installed Resource Pack, read and verified in the Worker.
import { Effect } from "effect";

import { fetchRange } from "@zotlit/resource-pack/fetch-range.ts";
import { readPackEntry } from "@zotlit/resource-pack/reader.ts";
import type { ReadRange } from "@zotlit/resource-pack/reader.ts";
import type { ReadSegmenter } from "@zotlit/zotero-reads/worker/segmenter.ts";

/** Reads the binary from the pack file that `open` gives for the URL the renderer names. */
export const readSegmenterOver = (
  open: (url: string) => ReadRange,
): ReadSegmenter =>
  Effect.fn("readSegmenterOver")(function* ({ url, entry }) {
    // boundary: the pack reader answers each failure as a value.
    const read = yield* Effect.promise(() => readPackEntry(open(url), entry));
    return read.ok ? read.bytes : yield* Effect.fail(read.failure);
  });

/**
 * Reads the binary from the pack file the renderer names. The worker shares
 * the renderer's origin, so the same resource URL answers it.
 */
export const readSegmenterFromPack: ReadSegmenter =
  readSegmenterOver(fetchRange);
