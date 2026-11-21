// The Worker's read of the Chinese Segmenter binary: its Pack Entry in the
// installed Resource Pack, read and verified in the Worker.
import { Effect } from "effect";

import { SegmenterUnavailable } from "@zotlit/item-lookup";
import { fetchRange } from "@zotlit/resource-pack/fetch-range.ts";
import type { PackFailure } from "@zotlit/resource-pack/format.ts";
import { readPackEntry } from "@zotlit/resource-pack/reader.ts";
import type { ReadSegmenter } from "@zotlit/zotero-reads/worker/segmenter.ts";

/** The reason of a refusal, as the Segmenter switch logs it. */
function refusal(failure: PackFailure): string {
  switch (failure.kind) {
    case "pack-outdated":
    case "plugin-outdated":
      return `${failure.kind}: the pack has the compatibility integer ${failure.pack}, and this plugin reads ${failure.reader}`;
    case "entry-damaged":
    case "pack-unreadable":
      return `${failure.kind}: ${failure.detail}`;
    case "entry-missing":
      return `${failure.kind}: ${failure.name}`;
    case "pack-absent":
      return failure.kind;
  }
}

/**
 * Reads the binary from the pack file the renderer names. The worker shares
 * the renderer's origin, so the same resource URL answers it.
 */
export const readSegmenterFromPack: ReadSegmenter = Effect.fn(
  "readSegmenterFromPack",
)(function* ({ url, entry }) {
  // boundary: the pack reader answers each failure as a value.
  const read = yield* Effect.promise(() =>
    readPackEntry(fetchRange(url), entry),
  );
  if (!read.ok)
    return yield* new SegmenterUnavailable({
      message: `The Resource Pack gave no Chinese Segmenter (${refusal(read.failure)})`,
    });
  return read.bytes;
});
