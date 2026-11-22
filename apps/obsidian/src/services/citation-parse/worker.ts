import * as BrowserWorkerRunner from "@effect/platform-browser/BrowserWorkerRunner";
import { Effect, Layer } from "effect";
import { RpcServer } from "effect/rpc";

import { layerParseHandlers } from "@zotlit/citations/core/citation-parse/handlers.ts";
import { CitationParseRpc } from "@zotlit/citations/core/citation-parse/rpc.ts";

RpcServer.layer(CitationParseRpc, { disableTracing: true }).pipe(
  Layer.provide(layerParseHandlers),
  Layer.provide(
    RpcServer.layerProtocolWorkerRunner.pipe(
      Layer.provide(BrowserWorkerRunner.layer),
    ),
  ),
  Layer.launch,
  Effect.runFork,
);
