import { Effect } from "effect";

import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";

import { ExcerptImageError } from "./error.ts";
import { detectExcerptImageFormat, PNG_FORMAT, WEBP_FORMAT } from "./format.ts";
import { usableExcerptWebp } from "./webp.ts";

const logged = withLogCategory("excerpt-image");

export const encodeExcerptImage = Effect.fn("ExcerptImage.encode")(function* (
  canvas: HTMLCanvasElement,
) {
  const blob = yield* Effect.tryPromise(
    () =>
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (encoded) =>
            encoded
              ? resolve(encoded)
              : reject(new Error("Excerpt encoding failed")),
          "image/webp",
          1,
        ),
      ),
  );
  const bytes = new Uint8Array(
    yield* Effect.tryPromise(() => blob.arrayBuffer()),
  );
  if (usableExcerptWebp(bytes, { width: canvas.width, height: canvas.height }))
    return { bytes, format: WEBP_FORMAT };
  if (detectExcerptImageFormat(bytes) === PNG_FORMAT) {
    yield* Effect.logDebug(
      "Canvas has no lossless WebP encoder; the excerpt stays PNG",
    ).pipe(
      Effect.annotateLogs({
        bytes: bytes.byteLength,
        width: canvas.width,
        height: canvas.height,
      }),
    );
    return { bytes, format: PNG_FORMAT };
  }
  return yield* new ExcerptImageError({
    message: "Canvas produced an unsupported image payload",
  });
}, logged);
