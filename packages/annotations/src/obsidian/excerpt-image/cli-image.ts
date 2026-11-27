import type { ExcerptImage } from "#core/excerpt-image/format.ts";
import type { PlatformError } from "effect";
import { Cause, Data, Effect, Result, Schema } from "effect";
import type { CliData } from "obsidian";

import { renderDiagnostic } from "@zotlit/item-query";
import {
  catchRejection,
  cliIndexedKey,
  cliParams,
  decodeCliParams,
} from "@zotlit/obsidian-kit/cli-params.ts";
import {
  INVALID_ARGUMENT_HINT,
  SOURCE_UNAVAILABLE_HINT,
  createRenderedCliDiagnostics,
} from "@zotlit/obsidian-kit/worker/cli-diagnostic.ts";

import type { ExcerptRequest } from "./contract.ts";
import type {
  ExcerptFilesUnavailable,
  ExcerptSourceUnavailable,
} from "./request.ts";
import type { ExcerptOutcome } from "./service.ts";

const contractVersion = 2;

export const ANNOTATION_IMAGE_COMMAND = "zotlit:annotation-image";

const { diagnostic, rejectionDiagnostic } = createRenderedCliDiagnostics<
  {
    "invalid-argument": string;
    "source-unavailable": string;
  },
  { parameter: string }
>(
  {
    "invalid-argument": INVALID_ARGUMENT_HINT,
    "source-unavailable": SOURCE_UNAVAILABLE_HINT,
  },
  "invalid-argument",
);

const imageParams = cliParams(
  {
    key: Schema.String.check(
      cliIndexedKey("Give one Annotation Indexed Key as key=<indexed-key>."),
    ),
  },
  { key: "Give one Annotation Indexed Key as key=<indexed-key>." },
);

export interface AnnotationImagePorts {
  read(
    key: string,
  ): Effect.Effect<
    ExcerptRequest | ExcerptFilesUnavailable | null,
    ExcerptSourceUnavailable
  >;
  resolve(request: ExcerptRequest): Effect.Effect<ExcerptOutcome, unknown>;
  publish(
    fingerprint: string,
    bytes: Uint8Array,
  ): Effect.Effect<string, PlatformError.PlatformError>;
  exists(path: string): Effect.Effect<boolean>;
}

class ImageAnswerError extends Data.TaggedError("ImageAnswerError")<{
  readonly cause: unknown;
}> {}

const attempt = <A>(run: (signal: AbortSignal) => PromiseLike<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new ImageAnswerError({ cause }),
  });

function envelope(tail: object): string {
  return JSON.stringify(
    { contractVersion, command: ANNOTATION_IMAGE_COMMAND, ...tail },
    null,
    2,
  );
}

export const answerAnnotationImage = Effect.fn("AnnotationImageCli.answer")(
  function* (params: CliData, ports: AnnotationImagePorts) {
    const { key } = yield* decodeCliParams(params, imageParams, {
      command: ANNOTATION_IMAGE_COMMAND,
    });
    const read = yield* Effect.result(ports.read(key));
    if (Result.isFailure(read)) {
      return envelope({
        ok: false,
        diagnostic: diagnostic("source-unavailable", read.failure.message),
      });
    }
    const request = read.success;
    if (!request)
      return imageFailure(
        "annotation-not-found",
        `No Annotation has the key '${key}'.`,
      );
    if (
      request.annotation.type !== "image" &&
      request.annotation.type !== "ink"
    )
      return imageFailure(
        "not-an-image-annotation",
        `Annotation '${key}' has no Excerpt Image.`,
      );
    if ("kind" in request)
      return imageFailure(
        "file-unavailable",
        "The Zotero online library is the library source, and it holds no PDF or Zotero cache image on this device.",
        NEEDS_LOCAL_ZOTERO_HINT,
      );
    return yield* imageAnswer({ key, request, ports }).pipe(
      Effect.catchTag("ImageAnswerError", ({ cause }) =>
        Effect.succeed(
          Cause.isTimeoutError(cause)
            ? imageFailure(
                "render-timeout",
                "The Excerpt Image exceeded the 35 second rendering deadline.",
              )
            : imageFailure(
                "render-failed",
                `The Excerpt Image could not be prepared: ${String(cause)}`,
              ),
        ),
      ),
    );
  },
  catchRejection((rejected) =>
    envelope({ ok: false, diagnostic: rejectionDiagnostic(rejected) }),
  ),
);

const imageAnswer = Effect.fn("AnnotationImageCli.image")(function* ({
  key,
  request,
  ports,
}: {
  key: string;
  request: ExcerptRequest;
  ports: AnnotationImagePorts;
}) {
  const outcome = yield* ports
    .resolve(request)
    .pipe(Effect.mapError((cause) => new ImageAnswerError({ cause })));
  if (outcome.kind === "available") {
    const path =
      outcome.provenance === "zotero"
        ? request.zoteroPngPath
        : yield* pngBytes(outcome).pipe(
            Effect.flatMap((bytes) =>
              ports
                .publish(outcome.identity.key, bytes)
                .pipe(
                  Effect.mapError((cause) => new ImageAnswerError({ cause })),
                ),
            ),
          );
    if (!path)
      return imageFailure(
        "render-failed",
        "The Excerpt Image has no file path.",
      );
    return envelope({
      ok: true,
      key,
      path,
      format: "png",
      provenance: outcome.provenance,
    });
  }
  const pdfExists =
    request.pdfPath !== null && (yield* ports.exists(request.pdfPath));
  const cacheExists =
    request.zoteroPngPath !== null &&
    (yield* ports.exists(request.zoteroPngPath));
  return !pdfExists && !cacheExists
    ? imageFailure(
        "file-unavailable",
        "The PDF and Zotero cache image are unavailable on this device.",
      )
    : imageFailure("render-failed", "The Excerpt Image could not be rendered.");
});

const IMAGE_HINTS = {
  "annotation-not-found":
    "Use an Annotation key from zotlit:query from=annotations.",
  "not-an-image-annotation":
    "Use the key of an image or ink Annotation with hasExcerptImage=true.",
  "file-unavailable":
    "Ask the user to download the PDF in Zotero, then run the command again.",
  "render-failed":
    "Ask the user to open the PDF in Zotero and check the marked region, then run the command again; check the plugin log if it still fails.",
  "render-timeout":
    "Run the command again; if the image still times out, ask the user to open the PDF in Zotero so it can generate a cache image.",
} as const;

const NEEDS_LOCAL_ZOTERO_HINT =
  "Ask the user to select Zotero on this computer as the library source in Settings → Zotero → Library source, then run the command again.";

function imageFailure(
  code: keyof typeof IMAGE_HINTS,
  message: string,
  hint: string = IMAGE_HINTS[code],
): string {
  return envelope({
    ok: false,
    diagnostic: renderDiagnostic({ code, message, hint }),
  });
}

function pngBytes(
  image: ExcerptImage,
): Effect.Effect<Uint8Array, ImageAnswerError> {
  if (image.format.format === "png") return Effect.succeed(image.bytes);
  return Effect.gen(function* () {
    const bitmap = yield* Effect.acquireRelease(
      attempt(() =>
        createImageBitmap(
          new Blob([image.bytes as BlobPart], { type: image.format.mimeType }),
        ),
      ),
      (bitmap) => Effect.sync(() => bitmap.close()),
    );
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context)
      return yield* new ImageAnswerError({
        cause: new Error("Cannot create the Excerpt Image canvas"),
      });
    context.drawImage(bitmap, 0, 0);
    const blob = yield* attempt(
      () =>
        new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (encoded) =>
              encoded
                ? resolve(encoded)
                : reject(new Error("PNG encoding failed")),
            "image/png",
          ),
        ),
    );
    return new Uint8Array(yield* attempt(() => blob.arrayBuffer()));
  }).pipe(Effect.scoped);
}
