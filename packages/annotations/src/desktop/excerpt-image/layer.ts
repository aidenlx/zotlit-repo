import type { ExcerptImage } from "#core/excerpt-image/format.ts";
import type { ExcerptRequest } from "#obsidian/excerpt-image/contract.ts";
import type { ExcerptOutcomeScope } from "#obsidian/excerpt-image/outcome-scope.ts";
import type { ExcerptReaderDocuments } from "#obsidian/excerpt-image/reader-borrow.ts";
import type { ExcerptEngine } from "#obsidian/excerpt-image/renderer.ts";
import type {
  ExcerptCache,
  ExcerptEntry,
  ExcerptError,
  ExcerptIdentity,
  ExcerptOutcome,
  PdfStamp,
} from "#obsidian/excerpt-image/service.ts";
import type { ExcerptStore } from "#obsidian/excerpt-image/store.ts";
import type { Cause, PlatformError } from "effect";
import { Effect, Fiber, FileSystem, Layer, Scope, Semaphore } from "effect";
import { loadPdfJs } from "obsidian";

import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { isScopeClosed } from "@zotlit/plugin-kernel/effect-scope.ts";
import type { ReaderApi } from "@zotlit/reader-api";

import { excerptKey } from "./key.ts";
import { usableExcerptPng } from "./png.ts";
import { reapExcerptTemps } from "./reap-temps.ts";

import { ExcerptImageError } from "#core/excerpt-image/error.ts";
import {
  openExcerptFile,
  pdfStamp,
  readBounded,
} from "#core/excerpt-image/file.ts";
import { PNG_FORMAT } from "#core/excerpt-image/format.ts";
import { makeExcerptPdfQueue } from "#core/excerpt-image/pdf-queue.ts";
import {
  excerptAnnotationRecord,
  excerptFingerprint,
} from "#obsidian/excerpt-image/contract.ts";
import { readerEngine } from "#obsidian/excerpt-image/engine.ts";
import { obsidianPdfJsEngine } from "#obsidian/excerpt-image/obsidian-pdfjs.ts";
import { ExcerptRenderer } from "#obsidian/excerpt-image/renderer.ts";
import {
  ExcerptImageService,
  supersedes,
} from "#obsidian/excerpt-image/service.ts";
import { ReaderConnection } from "#obsidian/reader-connection/service.ts";

const logged = withLogCategory("excerpt-image");
const debug = (message: string, fields?: Record<string, unknown>) =>
  Effect.logDebug(message).pipe(Effect.annotateLogs(fields ?? {}), logged);
export interface ExcerptDeps {
  cache?: ExcerptCache;
  openStore?: () => Promise<ExcerptStore>;
  stamp?: (path: string) => Promise<PdfStamp>;
  read?: (path: string, signal: AbortSignal) => Promise<Uint8Array>;
  render?: (
    request: ExcerptRequest,
    signal: AbortSignal,
  ) => Promise<ExcerptImage>;
  readers?: ExcerptReaderDocuments;
}

export const MAX_FALLBACK_BYTES = 32 * 1024 * 1024;
const EXCERPT_JOB_DEADLINE_MS = 35_000;
const STALLED: ExcerptOutcome = { kind: "unavailable" };

interface Pending {
  fiber: Fiber.Fiber<ExcerptOutcome, ExcerptError>;
  cancelled: boolean;
  users: number;
  evidence: { pdf?: PdfStamp };
}
interface ExcerptDemand {
  fingerprint: string;
  version: number | null;
  jobs: number;
}
interface ExcerptProbe {
  pdf: PdfStamp | undefined;
  retained: ExcerptOutcome | undefined;
  cached: ExcerptEntry | undefined;
}
function validatedEntry({ pdf, cached }: ExcerptProbe) {
  return cached &&
    (!pdf ||
      (pdf.size === cached.pdf.size && pdf.mtimeMs === cached.pdf.mtimeMs))
    ? cached
    : undefined;
}

export const layerExcerptImage = (deps: ExcerptDeps = {}) =>
  Layer.effect(
    ExcerptImageService,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const scope = yield* Scope.Scope;
      const pending = new Map<string, Pending>();
      const demands = new Map<string, ExcerptDemand>();
      const queue = yield* makeExcerptPdfQueue();
      const clearing = Semaphore.makeUnsafe(1);
      let generation = 0;
      let operations = 0;
      let stalled = false;
      const connection = yield* ReaderConnection;
      const obsidianEngine = obsidianPdfJsEngine(loadPdfJs);
      let untested: ReaderApi | undefined;
      const engine = Effect.gen(function* () {
        const state = yield* connection.current;
        if (state.status !== "connected") return obsidianEngine;
        const reader = readerEngine(state.api);
        if (reader) return reader;
        if (untested !== state.api) {
          untested = state.api;
          yield* Effect.logWarning(
            "ZotLit Reader's pdf.js build is untested; excerpts draw with Obsidian's pdf.js",
          ).pipe(
            Effect.annotateLogs({ pdfjsBuild: state.api.pdfjsBuild }),
            logged,
          );
        }
        return obsidianEngine;
      });
      const renderer = deps.render
        ? undefined
        : new ExcerptRenderer({ readers: deps.readers });
      if (renderer) yield* Effect.addFinalizer(() => renderer.dispose);
      let cache = deps.cache;
      if (deps.openStore) {
        const store = yield* Effect.acquireDisposable(
          Effect.tryPromise(() => deps.openStore!()),
        ).pipe(
          Effect.catch((error) =>
            debug("Excerpt cache open failed", { error }).pipe(
              Effect.as(undefined),
            ),
          ),
        );
        if (store) cache = store;
      }
      yield* Effect.addFinalizer(() => queue.idle);

      const stamp = Effect.fnUntraced(function* (path: string, key: string) {
        const reading: Effect.Effect<
          PdfStamp,
          Cause.UnknownError | PlatformError.PlatformError
        > = deps.stamp
          ? Effect.tryPromise(() => deps.stamp!(path))
          : fs.stat(path).pipe(Effect.map((info) => pdfStamp(info)));
        return yield* reading.pipe(
          Effect.catch((error) =>
            debug("Excerpt PDF freshness unavailable", { key, error }).pipe(
              Effect.as(undefined),
            ),
          ),
        );
      });
      const publishLatest = Effect.fnUntraced(function* (
        request: ExcerptRequest,
        context: { generation: number },
        reference: ExcerptIdentity,
      ) {
        const store = request.sourceScope ? cache : undefined;
        if (!store?.putLatest || context.generation !== generation) return;
        const annotation = excerptAnnotationRecord(request);
        const demand = demands.get(annotation);
        if (demand && demand.fingerprint !== reference.fingerprint) return;
        yield* Effect.tryPromise(() =>
          store.putLatest!(annotation, reference),
        ).pipe(
          Effect.catch((error) =>
            debug("Excerpt latest reference write failed", {
              key: reference.key,
              error,
            }),
          ),
        );
      });
      const advanceDemand = (
        annotation: string,
        fingerprint: string,
        version: number | null,
      ) => {
        let demand = demands.get(annotation);
        if (!demand) {
          demand = { fingerprint, version, jobs: 0 };
          demands.set(annotation, demand);
        } else if (supersedes(version, demand.version)) {
          demand.fingerprint = fingerprint;
          demand.version = version;
        }
        return demand;
      };
      const probe = Effect.fnUntraced(function* (
        request: ExcerptRequest,
        key: string,
        outcomes: ExcerptOutcomeScope | undefined,
      ) {
        const pdf = request.pdfPath
          ? yield* stamp(request.pdfPath, key)
          : undefined;
        const retained = outcomes?.get(key, pdf);
        if (retained) return { pdf, retained, cached: undefined };
        const store = request.sourceScope ? cache : undefined;
        const cached = store
          ? yield* Effect.tryPromise(() => store.get(key, pdf)).pipe(
              Effect.catch((error) =>
                debug("Excerpt cache read failed", { key, error }).pipe(
                  Effect.as(undefined),
                ),
              ),
            )
          : undefined;
        return { pdf, retained: undefined, cached };
      });
      const fallbackRead = Effect.fnUntraced(function* (path: string) {
        const file = yield* openExcerptFile(path).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
        );
        const { size } = pdfStamp(yield* file.stat);
        if (size > MAX_FALLBACK_BYTES)
          return yield* new ExcerptImageError({
            message: "Zotero image exceeds byte limit",
          });
        const bytes = yield* readBounded(file, size + 1);
        if (bytes.length > size)
          return yield* new ExcerptImageError({
            message: "Zotero image changed while reading",
          });
        return bytes;
      }, Effect.scoped);
      const renderHost = (request: ExcerptRequest) =>
        Effect.suspend(() => {
          let running: Promise<ExcerptImage> | undefined;
          return Effect.tryPromise(
            (signal) => (running = deps.render!(request, signal)),
          ).pipe(
            Effect.onInterrupt(() =>
              Effect.promise(
                () =>
                  running?.then(
                    () => undefined,
                    () => undefined,
                  ) ?? Promise.resolve(),
              ).pipe(
                Effect.timeoutOrElse({
                  duration: 5_000,
                  orElse: () =>
                    Effect.sync(() => {
                      stalled = true;
                    }).pipe(
                      Effect.andThen(
                        debug("Excerpt queue stopped after unsettled teardown"),
                      ),
                    ),
                }),
              ),
            ),
          );
        });
      const render = Effect.fnUntraced(function* (
        request: ExcerptRequest,
        context: {
          generation: number;
          probe: ExcerptProbe;
          identity: ExcerptIdentity;
          evidence: { pdf?: PdfStamp };
          engine: ExcerptEngine;
        },
      ) {
        const { identity, evidence } = context;
        const { key } = identity;
        const persistent = request.sourceScope ? cache : undefined;
        const outcome = yield* Effect.gen(function* () {
          const pdf = context.probe.pdf
            ? ((yield* stamp(request.pdfPath!, key)) ?? context.probe.pdf)
            : undefined;
          const rendered = { ...identity, pdf: pdf ?? null };
          const image = yield* deps.render
            ? renderHost(request)
            : renderer!
                .render(request, context.engine)
                .pipe(Effect.provideService(FileSystem.FileSystem, fs));
          evidence.pdf = pdf;
          if (pdf && context.generation === generation && persistent) {
            const stored = yield* persistent.put(key, { ...image, pdf }).pipe(
              Effect.as(true),
              Effect.catch((error) =>
                debug("Excerpt cache write failed", { key, error }).pipe(
                  Effect.as(false),
                ),
              ),
            );
            if (stored) yield* publishLatest(request, context, rendered);
          }
          yield* debug("Excerpt rendered", {
            key,
            bytes: image.bytes.length,
            format: image.format.format,
            freshnessChecked: !!pdf,
          });
          return {
            kind: "available",
            ...image,
            provenance: "rendered",
            freshness: pdf ? "checked" : "unchecked",
            identity: rendered,
          } satisfies ExcerptOutcome;
        }).pipe(
          Effect.catch((error) =>
            debug("Excerpt rendering failed; checking Zotero image", {
              key,
              error,
            }).pipe(Effect.as(undefined)),
          ),
        );
        if (outcome) return outcome;
        if (request.zoteroPngPath) {
          const reading: Effect.Effect<
            Uint8Array,
            Cause.UnknownError | ExcerptImageError | PlatformError.PlatformError
          > = deps.read
            ? Effect.tryPromise((signal) =>
                deps.read!(request.zoteroPngPath!, signal),
              )
            : fallbackRead(request.zoteroPngPath);
          const bytes = yield* reading.pipe(
            Effect.catch((error) =>
              debug("Zotero excerpt read failed", { key, error }).pipe(
                Effect.as(undefined),
              ),
            ),
          );
          if (
            bytes &&
            bytes.length <= MAX_FALLBACK_BYTES &&
            usableExcerptPng(
              Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
            )
          ) {
            return {
              kind: "available",
              bytes,
              format: PNG_FORMAT,
              provenance: "zotero",
              freshness: "uncertain",
              identity: { ...identity, pdf: null },
            } satisfies ExcerptOutcome;
          }
        }
        return { kind: "unavailable" } satisfies ExcerptOutcome;
      });
      const admit = Effect.fnUntraced(function* (
        pendingKey: string,
        request: ExcerptRequest,
        context: {
          key: string;
          generation: number;
          outcomes: ExcerptOutcomeScope | undefined;
          engine: ExcerptEngine;
        },
      ) {
        const annotation = excerptAnnotationRecord(request);
        const fingerprint = excerptFingerprint(request.annotation);
        const version = request.annotation.version;
        const live = pending.get(pendingKey);
        if (live && !live.cancelled) {
          advanceDemand(annotation, fingerprint, version);
          return live;
        }
        const sequence = queue.nextSequence();
        const evidence: { pdf?: PdfStamp } = {};
        const job = Effect.gen(function* () {
          if (context.outcomes)
            yield* Effect.acquireDisposable(
              Effect.sync(() => context.outcomes!.admit()),
            );
          const checked = yield* queue
            .preflight(probe(request, context.key, context.outcomes))
            .pipe(Effect.timeout(EXCERPT_JOB_DEADLINE_MS));
          evidence.pdf = checked.pdf;
          const identity: ExcerptIdentity = {
            key: context.key,
            fingerprint,
            pdf: checked.pdf ?? null,
          };
          if (checked.retained) return checked.retained;
          const cached = validatedEntry(checked);
          if (cached) {
            yield* publishLatest(request, context, identity);
            return {
              kind: "available",
              bytes: cached.bytes,
              format: cached.format,
              provenance: "cache",
              freshness: checked.pdf ? "checked" : "unchecked",
              identity,
            } satisfies ExcerptOutcome;
          }
          if (stalled) return STALLED;
          const { admitted, awaiting } = queue.diagnostics;
          yield* debug("Excerpt job entering the PDF queue", {
            key: context.key,
            admitted,
            awaiting,
          });
          const admission = yield* queue.reserve;
          return yield* admission.render(
            Effect.suspend(() =>
              stalled
                ? Effect.succeed<ExcerptOutcome>(STALLED)
                : render(request, {
                    ...context,
                    probe: checked,
                    identity,
                    evidence,
                  }).pipe(Effect.timeout(EXCERPT_JOB_DEADLINE_MS)),
            ),
            { pdf: request.pdfPath ?? "", sequence },
          );
        }).pipe(Effect.scoped);
        const fiber = yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            advanceDemand(annotation, fingerprint, version).jobs++;
          }),
          () => job,
          () =>
            Effect.sync(() => {
              if (pending.get(pendingKey)?.evidence === evidence)
                pending.delete(pendingKey);
              const held = demands.get(annotation);
              if (held) {
                held.jobs--;
                if (held.jobs === 0 && held.version === null)
                  demands.delete(annotation);
              }
            }),
        ).pipe(Effect.forkIn(scope, { startImmediately: true }));
        const entry: Pending = { fiber, cancelled: false, users: 0, evidence };
        pending.set(pendingKey, entry);
        return entry;
      });
      const resolveRequest = Effect.fnUntraced(function* (
        request: ExcerptRequest,
        outcomes?: ExcerptOutcomeScope,
      ) {
        const snapshot = structuredClone(request);
        const currentGeneration = generation;
        yield* clearing.withPermit(Effect.void);
        if (isScopeClosed(scope)) return yield* Effect.interrupt;
        const chosen = yield* engine;
        const key = excerptKey(snapshot, chosen.id);
        const pendingKey = JSON.stringify([
          currentGeneration,
          key,
          snapshot.pdfPath,
          snapshot.zoteroPngPath,
        ]);
        return yield* Effect.acquireUseRelease(
          Effect.gen(function* () {
            const entry = yield* admit(pendingKey, snapshot, {
              key,
              generation: currentGeneration,
              outcomes,
              engine: chosen,
            });
            entry.users++;
            return entry;
          }),
          (entry) =>
            Fiber.join(entry.fiber).pipe(
              Effect.tap((outcome) =>
                Effect.sync(() => {
                  if (outcome !== STALLED)
                    outcomes?.retain(key, entry.evidence.pdf, outcome);
                }),
              ),
            ),
          (entry) =>
            Effect.gen(function* () {
              if (--entry.users === 0) {
                entry.cancelled = true;
                yield* Fiber.interrupt(entry.fiber).pipe(
                  Effect.forkIn(scope, { startImmediately: true }),
                );
              }
            }),
        );
      });
      const operation = Effect.fn("ExcerptImageService.operation")(
        (options: { outcomes?: ExcerptOutcomeScope } = {}) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              operations++;
              return {
                resolve: (request: ExcerptRequest) =>
                  resolveRequest(request, options.outcomes),
              };
            }),
            () =>
              Effect.gen(function* () {
                if (--operations !== 0) return;
                const settled = !queue.busy;
                const release = queue.teardown(
                  Effect.suspend(() =>
                    operations === 0 && renderer
                      ? renderer.release
                      : Effect.void,
                  ),
                );
                const fiber = yield* release.pipe(
                  Effect.forkIn(scope, { startImmediately: true }),
                );
                if (settled) yield* Fiber.join(fiber);
              }),
          ),
      );
      return ExcerptImageService.of({
        resolve: Effect.fn("ExcerptImageService.resolve")((request) =>
          Effect.scoped(
            Effect.gen(function* () {
              const held = yield* operation();
              return yield* held.resolve(request);
            }),
          ),
        ),
        operation,
        key: Effect.fn("ExcerptImageService.key")(function* (request) {
          return excerptKey(request, (yield* engine).id);
        }),
        stored: Effect.fn("ExcerptImageService.stored")(function* (request) {
          yield* clearing.withPermit(Effect.void);
          const store = request.sourceScope ? cache : undefined;
          if (!store?.latest) return null;
          const annotation = excerptAnnotationRecord(request);
          const reference = yield* Effect.tryPromise(() =>
            store.latest!(annotation),
          ).pipe(
            Effect.catch((error) =>
              debug("Excerpt latest reference read failed", {
                annotation,
                error,
              }).pipe(Effect.as(undefined)),
            ),
          );
          if (!reference) return null;
          const entry = yield* Effect.tryPromise(() =>
            store.get(reference.key, reference.pdf ?? undefined),
          ).pipe(
            Effect.catch((error) =>
              debug("Excerpt latest image read failed", {
                key: reference.key,
                error,
              }).pipe(Effect.as(undefined)),
            ),
          );
          return entry
            ? {
                kind: "available",
                bytes: entry.bytes,
                format: entry.format,
                provenance: "cache",
                freshness: "unchecked",
                identity: reference,
              }
            : null;
        }),
        clear: Effect.suspend(() => {
          generation++;
          return clearing.withPermit(
            Effect.tryPromise(async () => {
              if (deps.openStore && !cache)
                throw new Error("Excerpt cache could not be opened");
              await cache?.clear?.();
            }).pipe(Effect.uninterruptible),
          );
        }).pipe(Effect.withSpan("ExcerptImageService.clear")),
        get rendererDiagnostics() {
          return renderer?.diagnostics;
        },
        get queueDiagnostics() {
          return queue.diagnostics;
        },
      });
    }),
  );

export function layerExcerptImages(options: {
  openStore: () => Promise<ExcerptStore>;
  readers: ExcerptReaderDocuments;
}) {
  return layerExcerptImage(options).pipe(
    Layer.merge(
      Layer.effectDiscard(reapExcerptTemps().pipe(Effect.forkScoped)),
    ),
  );
}
