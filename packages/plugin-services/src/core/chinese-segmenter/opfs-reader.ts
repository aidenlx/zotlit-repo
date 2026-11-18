// The Worker's read of an installed Chinese Segmenter binary: the OPFS store
// that this service installs into.
import { Effect } from "effect";

import { SegmenterUnavailable } from "@zotlit/item-lookup";
import type { ReadSegmenter } from "@zotlit/zotero-reads/worker/segmenter.ts";

import { createOpfsBinaryStore } from "#core/managed-binary/store.ts";

/**
 * Reads the binary from the device-wide OPFS store the Chinese Segmenter
 * service installs into. The worker shares the renderer's origin, so it sees
 * the same store.
 */
export const readSegmenterFromOpfs: ReadSegmenter = Effect.fn(
  "readSegmenterFromOpfs",
)(function* ({ directory, name }) {
  // boundary: OPFS exposes its file store through Promise APIs.
  const bytes = yield* Effect.tryPromise({
    try: () =>
      createOpfsBinaryStore(directory)
        .read(name)
        .then((file) => file?.arrayBuffer() ?? null),
    catch: segmenterUnavailable,
  });
  if (!bytes)
    return yield* new SegmenterUnavailable({
      message: `No Chinese Segmenter binary named ${name}`,
    });
  return bytes;
});

const segmenterUnavailable = (cause: unknown) =>
  new SegmenterUnavailable({
    message: cause instanceof Error ? cause.message : String(cause),
  });
