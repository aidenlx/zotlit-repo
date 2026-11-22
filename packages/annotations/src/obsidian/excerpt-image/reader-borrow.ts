import { Context, Effect, Layer } from "effect";

import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";

import type { ExcerptViewport } from "./geometry.ts";

import {
  openExcerptFile,
  pdfStamp,
  readBounded,
} from "#core/excerpt-image/file.ts";

const logged = withLogCategory("excerpt-image", "reader");

export const MAX_PDF_BYTES = 256 * 1024 * 1024;

export interface ExcerptCropPage {
  view: number[];
  getViewport(options: {
    scale: number;
    offsetX?: number;
    offsetY?: number;
  }): ExcerptViewport;
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: ExcerptViewport;
    intent: "display";
  }): {
    promise: Promise<void>;
    cancel(): void;
    onContinue?: (continueCallback: () => void) => void;
  };
}

export interface BorrowedExcerptDocument {
  readonly path: string;
  readonly document: object;
  bytes(): Promise<Uint8Array | null>;
  page(pageIndex: number): Promise<ExcerptCropPage | null>;
  current(): boolean;
}

export interface ExcerptReaderDocuments {
  borrow(path: string): BorrowedExcerptDocument | null;
}

export class ExcerptReaders extends Context.Service<
  ExcerptReaders,
  ExcerptReaderDocuments
>()("zotlit/annotations/ExcerptReaders") {}

export const layerExcerptReaders: Layer.Layer<ExcerptReaders> = Layer.sync(
  ExcerptReaders,
  (): ExcerptReaderDocuments => ({ borrow: () => null }),
);

export interface BorrowedExcerptCrop {
  page: ExcerptCropPage;
  current(): boolean;
}

interface BorrowVerdict {
  size: number;
  mtimeMs: number;
  match: boolean;
}

const verdicts = new WeakMap<object, BorrowVerdict>();

export const borrowedExcerptPage = Effect.fn("ExcerptImage.borrowedPage")(
  function* (options: {
    readers: ExcerptReaderDocuments | undefined;
    path: string | null;
    pageIndex: number;
  }) {
    const { readers, path, pageIndex } = options;
    if (!readers || !path) return null;
    const borrowed = readers.borrow(path);
    if (!borrowed) return null;
    const verdict = yield* verdictFor(borrowed).pipe(
      Effect.catch((error) =>
        Effect.logDebug("Reader document proof failed").pipe(
          Effect.annotateLogs({ path, error }),
          Effect.as(null),
        ),
      ),
    );
    if (!verdict?.match) return null;
    const page = yield* Effect.tryPromise(() => borrowed.page(pageIndex));
    if (!page || !borrowed.current()) return null;
    return {
      page,
      current: () => borrowed.current(),
    } satisfies BorrowedExcerptCrop;
  },
  logged,
);

const verdictFor = Effect.fnUntraced(function* (
  borrowed: BorrowedExcerptDocument,
) {
  const file = yield* openExcerptFile(borrowed.path);
  const info = pdfStamp(yield* file.stat);
  const remembered = verdicts.get(borrowed.document);
  if (
    remembered &&
    remembered.size === info.size &&
    remembered.mtimeMs === info.mtimeMs
  )
    return remembered;
  if (info.size > MAX_PDF_BYTES) {
    const verdict = { ...info, match: false };
    verdicts.set(borrowed.document, verdict);
    return verdict;
  }
  const data = yield* Effect.tryPromise(() => borrowed.bytes());
  let match = false;
  if (data && data.byteLength === info.size) {
    const bytes = yield* readBounded(file, info.size + 1);
    const after = pdfStamp(yield* file.stat);
    if (
      bytes.length !== info.size ||
      after.size !== info.size ||
      after.mtimeMs !== info.mtimeMs
    )
      return null;
    match = sameBytes(data, bytes);
  }
  const verdict = { ...info, match };
  verdicts.set(borrowed.document, verdict);
  return verdict;
}, Effect.scoped);

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++)
    if (left[index] !== right[index]) return false;
  return true;
}
