import { Effect, Layer } from "effect";
import type { FileSystem } from "effect";

import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";

import { ExcerptRenderer } from "#obsidian/excerpt-image/renderer.ts";
import type { ExcerptEngine } from "#obsidian/excerpt-image/renderer.ts";
import type { ExcerptRequest } from "#obsidian/excerpt-image/service.ts";

export class ExcerptRendererFixture implements AsyncDisposable {
  readonly #stack = new AsyncDisposableStack();
  readonly native;
  readonly #runtime;
  readonly #ready;
  readonly engine: ExcerptEngine;
  constructor(
    { engine, ...host }: ConstructorParameters<typeof ExcerptRenderer>[0] & { engine: Pick<ExcerptEngine, "load"> & Partial<Pick<ExcerptEngine, "id" | "borrows">> },
    fs: Layer.Layer<FileSystem.FileSystem>,
  ) {
    this.native = new ExcerptRenderer(host);
    this.engine = { id: engine.id ?? "fixture", borrows: engine.borrows ?? true, load: (source, options) => engine.load(source, options) };
    this.#runtime = buildRuntime(Layer.effectDiscard(
      Effect.addFinalizer(() => this.native.dispose),
    ).pipe(Layer.provideMerge(fs)), this.#stack);
    this.#ready = this.#runtime.context().then((context) => ({ context, bridge: effectBridge(this.#runtime) }));
  }
  get diagnostics() { return this.native.diagnostics; }
  async render(request: ExcerptRequest, signal?: AbortSignal) {
    const { context, bridge } = await this.#ready;
    return bridge.runPromise(this.native.render(request, this.engine).pipe(Effect.provideContext(context)), { signal });
  }
  async [Symbol.asyncDispose]() {
    await this.#ready;
    await this.#stack.disposeAsync();
  }
}
