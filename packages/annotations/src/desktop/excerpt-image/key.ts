// The canonical cache key of an excerpt request: a SHA-256 over the pixel
// inputs, which Node's crypto computes.

import type { ExcerptRequest } from "#obsidian/excerpt-image/contract.ts";
import { createHash } from "node:crypto";

import {
  EXCERPT_RENDERER_VERSION,
  excerptFingerprint,
  excerptSourceIdentity,
} from "#obsidian/excerpt-image/contract.ts";

function pixelInputs(request: ExcerptRequest): unknown[] {
  const { annotation: a, source } = request;
  return [
    request.sourceScope,
    excerptSourceIdentity(source),
    request.libraryID,
    request.attachmentKey,
    a.key,
    excerptFingerprint(a),
  ];
}

/** Excludes source revision and record versions, which cannot change the pixels. */
export function excerptKey(request: ExcerptRequest, engine: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        EXCERPT_RENDERER_VERSION,
        engine,
        ...pixelInputs(request),
      ]),
    )
    .digest("hex");
}

export function excerptAssetKey(request: ExcerptRequest): string {
  return createHash("sha256")
    .update(JSON.stringify([EXCERPT_RENDERER_VERSION, ...pixelInputs(request)]))
    .digest("hex");
}
