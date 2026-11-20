import type { HeadlessDocument } from "#/core/document/document.ts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

import {
  getDocument,
  PasswordException,
  PasswordResponses,
  PDFWorker,
} from "@zotlit/pdfjs/lib";

import { manageDocument } from "#/core/document/document.ts";
import { PdfLoadError } from "#/core/engine/error.ts";
import { readerServices } from "#/core/internal/scheduler.ts";
import { jbig2, openjpeg } from "#/generated/wasm.ts";
import workerSource from "#/generated/worker-source.ts";

export interface PdfEngineOptions {
  readonly idPrefix: string;
  fetchData(
    kind: "cmap" | "standard-font",
    filename: string,
    signal: AbortSignal,
  ): Promise<Uint8Array>;
}

export interface DocumentSource {
  readonly key: string;
  readonly name: string;
  read(signal: AbortSignal): Promise<Uint8Array>;
  watch?(onChange: () => void): () => void;
}

export interface PdfEngine extends Disposable {
  load(
    source: DocumentSource,
    options?: {
      readonly password?: string;
      readonly signal?: AbortSignal;
      readonly ownerDocument?: Document;
    },
  ): Promise<HeadlessDocument>;
}

const WASM: Readonly<Record<string, string>> = {
  "jbig2.wasm": jbig2,
  "openjpeg.wasm": openjpeg,
};

async function inflate(packed: string): Promise<Uint8Array<ArrayBuffer>> {
  const binary = atob(packed);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  const inflated = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(inflated).arrayBuffer());
}

function classify(cause: unknown): PdfLoadError {
  if (cause instanceof PasswordException) {
    return new PdfLoadError(
      cause.code === PasswordResponses.INCORRECT_PASSWORD
        ? "password-incorrect"
        : "password-required",
      { cause },
    );
  }
  return new PdfLoadError("invalid", { cause });
}

export function createPdfEngine(options: PdfEngineOptions): PdfEngine {
  const disposal = new AbortController();
  const disposed = new Promise<void>((resolve) => {
    disposal.signal.addEventListener("abort", () => resolve(), { once: true });
  });
  const destroy = (task: { destroy(): Promise<void> }) =>
    Promise.race([task.destroy(), disposed]);
  const retirements = new Set<() => void>();
  const wasm = new Map<string, Promise<Uint8Array>>();
  let workerScript: Promise<Uint8Array<ArrayBuffer>> | null = null;
  let spawned: {
    readonly url: string;
    readonly worker: Worker;
    readonly port: PDFWorker;
  } | null = null;

  const pdfWorker = (script: Uint8Array<ArrayBuffer>): PDFWorker => {
    if (!spawned) {
      const url = URL.createObjectURL(
        new Blob([script], { type: "text/javascript" }),
      );
      const worker = new Worker(url, { name: `${options.idPrefix}-pdfjs` });
      spawned = { url, worker, port: PDFWorker.create({ port: worker }) };
    }
    return spawned.port;
  };

  const wasmBytes = (filename: string): Promise<Uint8Array> => {
    let bytes = wasm.get(filename);
    if (!bytes) {
      const packed = WASM[filename];
      if (packed === undefined) {
        return Promise.reject(
          new Error(`No embedded wasm file named ${filename}`),
        );
      }
      bytes = inflate(packed);
      wasm.set(filename, bytes);
    }
    return bytes;
  };

  const binaryDataFactory = (signal: AbortSignal) =>
    class {
      fetch({
        kind,
        filename,
      }: {
        readonly kind: string;
        readonly filename: string;
      }): Promise<Uint8Array> {
        if (kind === "wasmUrl") return wasmBytes(filename);
        return options.fetchData(
          kind === "cMapUrl" ? "cmap" : "standard-font",
          filename,
          signal,
        );
      }
    };

  const open = (
    source: DocumentSource,
    access: {
      readonly password?: string;
      readonly ownerDocument?: Document;
    },
  ): Effect.Effect<HeadlessDocument, PdfLoadError> => {
    const lifetime = new AbortController();
    return Effect.gen(function* () {
      const script = (workerScript ??= inflate(workerSource));
      const data = yield* Effect.tryPromise({
        try: (signal) => source.read(signal),
        catch: (cause) => new PdfLoadError("unreadable", { cause }),
      });
      const worker = pdfWorker(yield* Effect.promise(() => script));
      const task = getDocument({
        data,
        password: access.password,
        ownerDocument: access.ownerDocument,
        worker,
        docBaseId: options.idPrefix,
        useWorkerFetch: false,
        BinaryDataFactory: binaryDataFactory(
          AbortSignal.any([lifetime.signal, disposal.signal]),
        ),
        wasmUrl: "zpr-wasm/",
        cMapPacked: true,
      });
      const proxy = yield* Effect.tryPromise({
        try: () => task.promise,
        catch: classify,
      }).pipe(
        Effect.onError(() =>
          Effect.promise(() => {
            lifetime.abort();
            return destroy(task);
          }),
        ),
      );
      const managed = manageDocument(proxy, source.key);
      const retire = () => {
        managed.retire();
        lifetime.abort();
      };
      retirements.add(retire);
      return {
        ...managed.document,
        [Symbol.asyncDispose]: async () => {
          if (!retirements.delete(retire)) return;
          retire();
          await destroy(task);
        },
      };
    });
  };

  return {
    async load(source, loadOptions = {}) {
      if (disposal.signal.aborted) throw new PdfLoadError("engine-disposed");
      const exit = await Effect.runPromiseExitWith(readerServices)(
        open(source, loadOptions),
        {
          signal: loadOptions.signal
            ? AbortSignal.any([loadOptions.signal, disposal.signal])
            : disposal.signal,
        },
      );
      if (Exit.isSuccess(exit)) return exit.value;
      const failure = Cause.findErrorOption(exit.cause);
      if (Option.isSome(failure)) throw failure.value;
      if (Cause.hasInterrupts(exit.cause)) {
        throw new PdfLoadError(
          disposal.signal.aborted ? "engine-disposed" : "aborted",
        );
      }
      throw new PdfLoadError("invalid", { cause: Cause.squash(exit.cause) });
    },
    [Symbol.dispose]() {
      if (disposal.signal.aborted) return;
      disposal.abort();
      for (const retire of retirements) retire();
      retirements.clear();
      if (spawned) {
        spawned.port.destroy();
        spawned.worker.terminate();
        URL.revokeObjectURL(spawned.url);
        spawned = null;
      }
    },
  };
}
