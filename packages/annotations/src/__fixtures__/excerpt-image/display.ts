import { Effect, Layer } from "effect";

import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";

import { fakeReaderEngine } from "#__fixtures__/pdf-engine.ts";
import { ExcerptDisplays, layerExcerptDisplays } from "#desktop/excerpt-image/display.ts";
import { excerptKey } from "#desktop/excerpt-image/key.ts";
import type { ExcerptRequest } from "#obsidian/excerpt-image/contract.ts";
import { ExcerptImageService } from "#obsidian/excerpt-image/service.ts";
import type { AvailableExcerpt, ExcerptOutcome } from "#obsidian/excerpt-image/service.ts";

export class ExcerptDisplayFixture implements AsyncDisposable {
  readonly #stack = new AsyncDisposableStack();
  readonly #bridge;
  readonly service;
  readonly ready = Promise.resolve();

  constructor(deps: {
    queries: Pick<QueryClients["Service"], "client" | "invalidate" | "peek" | "read" | "watch">;
    resolve: (request: ExcerptRequest, signal?: AbortSignal) => Promise<ExcerptOutcome>;
    stored: (request: ExcerptRequest) => Promise<AvailableExcerpt | null>;
  }) {
    const runtime = buildRuntime(layerExcerptDisplays.pipe(Layer.provide(Layer.mergeAll(
      Layer.mock(QueryClients, deps.queries),
      Layer.mock(ExcerptImageService, {
        rendererDiagnostics: undefined,
        queueDiagnostics: { admitted: 0, rendering: 0, queued: 0, checking: 0, awaiting: 0 },
        resolve: (request) => Effect.tryPromise((signal) => deps.resolve(request, signal)),
        stored: (request) => Effect.promise(() => deps.stored(request)),
        key: (request) => Effect.sync(() => excerptKey(request, fakeReaderEngine)),
      }),
    ))), this.#stack);
    this.#bridge = effectBridge(runtime);
    this.service = runtime.runSync(ExcerptDisplays);
  }
  open() { return this.#bridge.runSync(this.service.open); }
  clear() { this.#bridge.runAndForget(this.service.clear); }
  refresh() { this.#bridge.runAndForget(this.service.refresh); }
  revalidate(request: ExcerptRequest) { this.#bridge.runAndForget(this.service.revalidate(request)); }
  [Symbol.asyncDispose]() { return this.#stack.disposeAsync(); }
}
