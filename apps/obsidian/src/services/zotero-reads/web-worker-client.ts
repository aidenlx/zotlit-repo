import { Context, Effect, Layer, Schema } from "effect";
import type { Scope } from "effect";
import type { RpcClient, RpcClientError } from "effect/rpc";

import type {
  StartWebWorkerOptions,
  WebWorkerPack,
  WebWorkerWasm,
} from "@zotlit/zotero-reads/client/web-worker.ts";
import type { ZoteroReadsWeb } from "@zotlit/zotero-reads/contract/web-worker-rpc.ts";

export class WebWorkerCodeUnreadable extends Schema.TaggedError<
  WebWorkerCodeUnreadable,
  { readonly brand: unique symbol }
>()("WebWorkerCodeUnreadable", {
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return "The code of the online library Worker in main.js does not load";
  }
}

export class ZoteroReadsWebWorker extends Context.Service<
  ZoteroReadsWebWorker,
  {
    readWasm(pack: WebWorkerPack): Effect.Effect<WebWorkerWasm>;
    start(
      wasm: Uint8Array<ArrayBuffer>,
      options: StartWebWorkerOptions,
    ): Effect.Effect<
      RpcClient.FromGroup<typeof ZoteroReadsWeb, RpcClientError.RpcClientError>,
      WebWorkerCodeUnreadable,
      Scope.Scope
    >;
  }
>()("zotlit/zotero-reads/ZoteroReadsWebWorker") {}

const loadWebWorker = () =>
  Promise.all([
    import("@zotlit/zotero-reads/client/web-worker.ts"),
    import("./embedded-text.ts"),
    import("virtual:zotero-reads-web-worker"),
    import("virtual:temporal-piece"),
  ]).then(
    async ([{ startWebWorker }, { inflateEmbedded }, source, temporal]) => ({
      startWebWorker,
      code: {
        source: await inflateEmbedded(source.default()),
        temporal: await inflateEmbedded(temporal.default()),
      },
    }),
  );

export const layerZoteroReadsWebWorker = Layer.succeed(
  ZoteroReadsWebWorker,
  ZoteroReadsWebWorker.of({
    readWasm: Effect.fn("ZoteroReadsWebWorker.readWasm")(function* (pack) {
      const { readWebWorkerWasm } = yield* Effect.promise(
        () => import("@zotlit/zotero-reads/client/web-worker.ts"),
      );
      return yield* readWebWorkerWasm(pack, __SQLITE_ENGINE_VERSION__);
    }),
    start: Effect.fn("ZoteroReadsWebWorker.start")(function* (wasm, options) {
      const { startWebWorker, code } = yield* Effect.tryPromise({
        try: () => loadWebWorker(),
        catch: (cause) => new WebWorkerCodeUnreadable({ cause }),
      });
      return yield* startWebWorker({ code, wasm }, options);
    }),
  }),
);
