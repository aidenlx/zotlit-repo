import { Effect } from "effect";

import { encodeExcerptImage as encode } from "#core/excerpt-image/encode.ts";

export function encodeExcerptImage(canvas: HTMLCanvasElement, signal: AbortSignal) {
  return Effect.runPromise(encode(canvas), { signal });
}
