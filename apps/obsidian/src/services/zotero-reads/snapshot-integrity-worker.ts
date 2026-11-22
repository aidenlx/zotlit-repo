import * as BrowserWorkerRunner from "@effect/platform-browser/BrowserWorkerRunner";
import { Effect, Layer } from "effect";
import { RpcServer } from "effect/rpc";

import {
  SnapshotIntegrity,
  verifySnapshotInProcess,
} from "@zotlit/zotero-reads/desktop/snapshot-integrity-check.ts";

RpcServer.layer(SnapshotIntegrity, { disableTracing: true }).pipe(
  Layer.provide(
    SnapshotIntegrity.toLayer({
      Check: ({ path }) => verifySnapshotInProcess(path),
    }),
  ),
  Layer.provide(
    RpcServer.layerProtocolWorkerRunner.pipe(
      Layer.provide(BrowserWorkerRunner.layer),
    ),
  ),
  Layer.launch,
  Effect.runFork,
);
