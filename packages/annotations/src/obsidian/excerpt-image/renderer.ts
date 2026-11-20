import { Effect } from "effect";

import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import type {
  DocumentSource,
  HeadlessDocument,
  LoadOptions,
} from "@zotlit/reader-api";

import { excerptSourceIdentity } from "./contract.ts";
import type { ExcerptRequest } from "./contract.ts";
import {
  clipExcerptBounds,
  excerptBounds,
  paintInk,
  viewportBounds,
} from "./geometry.ts";
import { MAX_PDF_BYTES, borrowedExcerptPage } from "./reader-borrow.ts";
import type {
  ExcerptCropPage,
  ExcerptReaderDocuments,
} from "./reader-borrow.ts";

import { encodeExcerptImage } from "#core/excerpt-image/encode.ts";
import { ExcerptImageError } from "#core/excerpt-image/error.ts";
import {
  openExcerptFile,
  pdfStamp,
  readBounded,
} from "#core/excerpt-image/file.ts";

export interface ExcerptRenderTask {
  promise: Promise<void>;
  cancel(): void;
  onContinue?: (continueCallback: () => void) => void;
}
export type ExcerptDocument = Pick<HeadlessDocument, "page"> & AsyncDisposable;

export interface ExcerptEngine {
  readonly id: string;
  load(source: DocumentSource, options?: LoadOptions): Promise<ExcerptDocument>;
}

/** A page of a document this renderer loaded itself, which it also cleans up. */
interface PdfPage extends ExcerptCropPage {
  cleanup(): boolean;
}
/** Only the exact task created by this renderer may change scheduling. */
export function usePromiseScheduling(
  page: unknown,
  task: ExcerptRenderTask,
): void {
  if (
    !page ||
    typeof page !== "object" ||
    !("_intentStates" in page) ||
    !(page._intentStates instanceof Map)
  ) {
    throw new Error("Unsupported PDF.js intent state");
  }
  const matches: { task: unknown; _useRequestAnimationFrame: boolean }[] = [];
  for (const state of page._intentStates.values()) {
    if (!state || !(state.renderTasks instanceof Set)) continue;
    for (const candidate of state.renderTasks) {
      if (
        candidate?.task === task &&
        typeof candidate._useRequestAnimationFrame === "boolean"
      )
        matches.push(candidate);
    }
  }
  if (matches.length !== 1) throw new Error("Unsupported PDF.js render task");
  matches[0]!._useRequestAnimationFrame = false;
}

export type ExcerptRendererPhase =
  | "pdf-reading"
  | "document-loading"
  | "page-rendering";

/**
 * How many crops this renderer drew, and where each one's document came from.
 *
 * The live flags above say what stands right now; these counts say what a
 * resolution did, so a caller can tell a crop that reused an open reader's
 * document from one that loaded the file itself. A crop is counted once it has
 * produced an image: a borrowed page the reader withdrew falls back to the
 * file, and only that fallback's crop is counted.
 */
export interface ExcerptRendererLoads {
  /** Crops drawn from a document an open reader already held. */
  borrowed: number;
  /** Crops drawn from a document this renderer loaded itself. */
  detached: number;
  /** PDF files this renderer opened for reading. */
  fileOpens: number;
  /** PDF documents this renderer loaded. */
  documentLoads: number;
}

export interface ExcerptRendererDiagnosticSnapshot {
  phase: ExcerptRendererPhase | "idle";
  jobActive: boolean;
  fileOpen: boolean;
  documentOpen: boolean;
  renderTaskActive: boolean;
  canvas: { width: number; height: number } | null;
  lastCanvas: { width: number; height: number } | null;
  loads: ExcerptRendererLoads;
  engine: string | null;
}

interface DiagnosticGate {
  phase: ExcerptRendererPhase;
  release: PromiseWithResolvers<void>;
}

const logged = withLogCategory("excerpt-image", "renderer");

/** Internal acceptance diagnostics. It does not alter work unless a test installs a gate. */
export class ExcerptRendererDiagnostics {
  #phase: ExcerptRendererPhase | "idle" = "idle";
  #jobActive = false;
  #fileOpen = false;
  #documentOpen = false;
  #renderTaskActive = false;
  #canvas?: HTMLCanvasElement;
  #lastCanvas?: { width: number; height: number };
  #engine: string | null = null;
  readonly #loads: ExcerptRendererLoads = {
    borrowed: 0,
    detached: 0,
    fileOpens: 0,
    documentLoads: 0,
  };
  #gate?: DiagnosticGate;

  snapshot(): ExcerptRendererDiagnosticSnapshot {
    return {
      phase: this.#phase,
      jobActive: this.#jobActive,
      fileOpen: this.#fileOpen,
      documentOpen: this.#documentOpen,
      renderTaskActive: this.#renderTaskActive,
      canvas: this.#canvas
        ? { width: this.#canvas.width, height: this.#canvas.height }
        : null,
      lastCanvas: this.#lastCanvas ? { ...this.#lastCanvas } : null,
      loads: { ...this.#loads },
      engine: this.#engine,
    };
  }

  hold(phase: ExcerptRendererPhase): void {
    if (this.#gate) throw new Error("Excerpt renderer diagnostic gate is busy");
    this.#gate = { phase, release: Promise.withResolvers<void>() };
  }

  release(): void {
    this.#gate?.release.resolve();
    this.#gate = undefined;
  }

  held(phase: ExcerptRendererPhase): boolean {
    return this.#gate?.phase === phase;
  }

  enter(phase: ExcerptRendererPhase) {
    return Effect.suspend(() => {
      this.#phase = phase;
      const gate = this.#gate;
      return gate?.phase === phase
        ? Effect.promise(() => gate.release.promise)
        : Effect.void;
    });
  }

  leave(phase: ExcerptRendererPhase): void {
    if (this.#phase === phase) this.#phase = "idle";
  }

  job(active: boolean): void {
    this.#jobActive = active;
  }

  file(open: boolean): void {
    this.#fileOpen = open;
  }

  /** One crop drew from an open reader's document. */
  borrowed(): void {
    this.#loads.borrowed++;
  }

  /** One crop drew from a document this renderer loaded itself. */
  detached(): void {
    this.#loads.detached++;
  }

  /** One PDF file handle was opened for reading. */
  openedFile(): void {
    this.#loads.fileOpens++;
  }

  /** One PDF document was loaded. */
  loadedDocument(engine: string): void {
    this.#loads.documentLoads++;
    this.#engine = engine;
  }

  document(open: boolean): void {
    this.#documentOpen = open;
  }

  renderTask(active: boolean): void {
    this.#renderTaskActive = active;
  }

  canvas(canvas?: HTMLCanvasElement): void {
    this.#canvas = canvas;
    if (canvas)
      this.#lastCanvas = { width: canvas.width, height: canvas.height };
  }

  canvasReset(): void {
    if (this.#canvas)
      this.#lastCanvas = {
        width: this.#canvas.width,
        height: this.#canvas.height,
      };
    this.#canvas = undefined;
  }

  close(): void {
    this.release();
    this.#phase = "idle";
    this.#jobActive = false;
    this.#fileOpen = false;
    this.#documentOpen = false;
    this.#renderTaskActive = false;
    this.#canvas = undefined;
  }
}

/** One resident document serves the serial queue; each render owns a Scope. */
export class ExcerptRenderer {
  readonly diagnostics = new ExcerptRendererDiagnostics();
  readonly #host;
  #session?: { key: string; document: ExcerptDocument };
  #unusable = false;
  #active = false;

  constructor(host: {
    canvas?: () => HTMLCanvasElement;
    readers?: ExcerptReaderDocuments;
  }) {
    this.#host = host;
  }

  readonly #close = Effect.gen({ self: this }, function* () {
    const session = this.#session;
    if (!session) return;
    yield* Effect.tryPromise(() =>
      session.document[Symbol.asyncDispose](),
    ).pipe(
      Effect.timeout(5_000),
      Effect.catch((error) => {
        const transitionedToUnusable = !this.#unusable;
        this.#unusable = true;
        return Effect.logDebug("Excerpt renderer teardown failed").pipe(
          Effect.annotateLogs({
            error,
            state: "unusable",
            transitionedToUnusable,
          }),
          logged,
        );
      }),
    );
    if (this.#session === session) {
      this.#session = undefined;
      this.diagnostics.document(false);
    }
  });

  readonly release = this.#close.pipe(
    Effect.withSpan("ExcerptRenderer.release"),
  );

  readonly dispose = Effect.gen({ self: this }, function* () {
    this.#unusable = true;
    yield* this.#close;
    this.diagnostics.close();
  });

  render = Effect.fn("ExcerptRenderer.render")(
    (request: ExcerptRequest, engine: ExcerptEngine) =>
      Effect.acquireUseRelease(
        Effect.suspend(() => {
          if (this.#unusable)
            return Effect.fail(
              new ExcerptImageError({ message: "Excerpt renderer is closed" }),
            );
          if (this.#active)
            return Effect.fail(
              new ExcerptImageError({ message: "Excerpt renderer is busy" }),
            );
          return Effect.sync(() => {
            this.#active = true;
            this.diagnostics.job(true);
          });
        }),
        () =>
          this.#render(request, engine).pipe(
            Effect.timeout(30_000),
            Effect.onError(() => this.#close),
          ),
        () =>
          Effect.sync(() => {
            this.#active = false;
            this.diagnostics.job(false);
          }),
      ),
    logged,
  );

  readonly #document = Effect.fnUntraced(function* (
    this: ExcerptRenderer,
    request: ExcerptRequest,
    engine: ExcerptEngine,
  ) {
    const file = yield* openExcerptFile(request.pdfPath!);
    this.diagnostics.file(true);
    this.diagnostics.openedFile();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => this.diagnostics.file(false)),
    );
    const info = pdfStamp(yield* file.stat);
    if (
      !Number.isSafeInteger(info.size) ||
      info.size < 0 ||
      info.size > MAX_PDF_BYTES
    )
      return yield* new ExcerptImageError({
        message: "PDF exceeds excerpt byte limit",
      });
    const key = JSON.stringify([
      engine.id,
      request.sourceScope,
      excerptSourceIdentity(request.source),
      request.libraryID,
      request.attachmentKey,
      request.pdfPath,
      info.size,
      info.mtimeMs,
    ]);
    if (this.#session?.key !== key) {
      yield* this.#close;
      if (this.#unusable)
        return yield* new ExcerptImageError({
          message: "Excerpt renderer is closed",
        });
      const data = yield* this.diagnostics
        .enter("pdf-reading")
        .pipe(
          Effect.andThen(readBounded(file, info.size + 1)),
          Effect.ensuring(
            Effect.sync(() => this.diagnostics.leave("pdf-reading")),
          ),
        );
      const after = pdfStamp(yield* file.stat);
      if (
        data.length !== info.size ||
        after.size !== info.size ||
        after.mtimeMs !== info.mtimeMs
      )
        return yield* new ExcerptImageError({
          message: "PDF changed while reading",
        });
      const path = request.pdfPath!;
      const bridge = yield* scopedBridge;
      this.diagnostics.document(true);
      this.diagnostics.loadedDocument(engine.id);
      const document = yield* Effect.tryPromise((signal) =>
        engine.load(
          {
            key: path,
            name: path,
            read: (readSignal) =>
              bridge.runPromise(
                this.diagnostics
                  .enter("document-loading")
                  .pipe(Effect.as(data)),
                { signal: readSignal },
              ),
          },
          { signal },
        ),
      ).pipe(
        Effect.onError(() =>
          Effect.sync(() => this.diagnostics.document(false)),
        ),
        Effect.ensuring(
          Effect.sync(() => this.diagnostics.leave("document-loading")),
        ),
      );
      this.#session = { key, document };
    }
    return this.#session.document;
  }, Effect.scoped);

  readonly #render = Effect.fnUntraced(function* (
    this: ExcerptRenderer,
    request: ExcerptRequest,
    engine: ExcerptEngine,
  ) {
    const position = request.annotation.position;
    if (
      !request.pdfPath ||
      !(
        (request.annotation.type === "image" &&
          position.kind === "pdf-rects") ||
        (request.annotation.type === "ink" && position.kind === "pdf-ink")
      )
    )
      return yield* new ExcerptImageError({ message: "Unsupported excerpt" });
    const borrowed = yield* borrowedExcerptPage({
      readers: this.#host.readers,
      path: request.pdfPath,
      pageIndex: position.pageIndex,
    });
    if (borrowed) {
      const image = yield* this.#crop(request, borrowed.page).pipe(
        Effect.catch((error) =>
          Effect.logDebug(
            "Borrowed reader page did not render; reading the file",
          ).pipe(
            Effect.annotateLogs({ path: request.pdfPath, error }),
            logged,
            Effect.as(null),
          ),
        ),
      );
      if (image && borrowed.current()) {
        this.diagnostics.borrowed();
        return image;
      }
    }
    const pdf = yield* this.#document(request, engine);
    if (this.#unusable)
      return yield* new ExcerptImageError({
        message: "Excerpt renderer is closed",
      });
    const page = yield* Effect.acquireRelease(
      Effect.tryPromise(
        () => pdf.page(position.pageIndex) as Promise<PdfPage | null>,
      ),
      (page) =>
        Effect.sync(() => {
          page?.cleanup();
        }),
      { interruptible: true },
    );
    if (!page)
      return yield* new ExcerptImageError({
        message: "Excerpt renderer is closed",
      });
    const image = yield* this.#crop(request, page);
    this.diagnostics.detached();
    return image;
  }, Effect.scoped);

  readonly #crop = Effect.fnUntraced(function* (
    this: ExcerptRenderer,
    request: ExcerptRequest,
    page: ExcerptCropPage,
  ) {
    const rect = excerptBounds(request.annotation);
    const crop = clipExcerptBounds(rect, page.view);
    const bounds = (scale: number) => {
      const viewport = page.getViewport({ scale });
      return viewportBounds(crop, viewport);
    };
    let scale = 4;
    let box = bounds(scale);
    if (!box.every(Number.isFinite) || box[2]! <= 0 || box[3]! <= 0)
      return yield* new ExcerptImageError({
        message: "Invalid PDF excerpt bounds",
      });
    scale *= Math.min(
      1,
      Math.sqrt(16_777_216 / (box[2]! * box[3]!)),
      8192 / Math.max(box[2]!, box[3]!),
    );
    box = bounds(scale);
    const canvas = yield* Effect.acquireRelease(
      Effect.sync(() =>
        // Renders offscreen, outside any Obsidian window.
        (this.#host.canvas ?? (() => document.createElement("canvas")))(),
      ),
      (canvas) =>
        Effect.sync(() => {
          canvas.width = 0;
          canvas.height = 0;
          this.diagnostics.canvasReset();
        }),
    );
    canvas.width = Math.max(1, Math.floor(box[2]!));
    canvas.height = Math.max(1, Math.floor(box[3]!));
    this.diagnostics.canvas(canvas);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context)
      return yield* new ExcerptImageError({ message: "Canvas unavailable" });
    const viewport = page.getViewport({
      scale,
      offsetX: -box[0]!,
      offsetY: -box[1]!,
    });
    const task = yield* Effect.acquireRelease(
      Effect.try(() =>
        page.render({ canvasContext: context, viewport, intent: "display" }),
      ),
      (task) =>
        Effect.sync(() => {
          task.cancel();
          this.diagnostics.renderTask(false);
        }),
    );
    this.diagnostics.renderTask(true);
    void task.promise.catch(() => undefined);
    yield* Effect.try(() => usePromiseScheduling(page, task));
    const bridge = yield* scopedBridge;
    if (this.diagnostics.held("page-rendering")) {
      task.onContinue = (continueCallback) => {
        bridge.runAndForget(
          this.diagnostics
            .enter("page-rendering")
            .pipe(Effect.andThen(Effect.sync(continueCallback))),
        );
      };
    } else {
      yield* this.diagnostics.enter("page-rendering");
    }
    yield* Effect.tryPromise(() => task.promise).pipe(
      Effect.ensuring(
        Effect.sync(() => this.diagnostics.leave("page-rendering")),
      ),
    );
    paintInk({ annotation: request.annotation, viewport, context });
    return yield* encodeExcerptImage(canvas);
  }, Effect.scoped);
}
