import type { WebWorkerInit } from "#contract/web-worker-rpc.ts";
import { Effect } from "effect";

import { loadSqliteWasm } from "@zotlit/drizzle-sqlite-wasm";
import type { SqliteWasm } from "@zotlit/drizzle-sqlite-wasm";

import { toDbUnavailable } from "./connection.ts";
import { wasmReplicaDriver } from "./replica-driver-wasm.ts";
import type { WebRootOptions } from "./serve-web-api.ts";
import { serveWebApiReads } from "./serve-web-api.ts";
import type { WorkerScope } from "./worker-launch.ts";

import { WebWorkerInitSchema } from "#contract/web-worker-rpc.ts";

const loadEngine = (init: WebWorkerInit): Promise<SqliteWasm> =>
  init.storage === "memory"
    ? loadSqliteWasm({ wasm: init.wasm, storage: "memory" })
    : loadSqliteWasm({
        wasm: init.wasm,
        storage: "opfs-sahpool",
        directory: init.config.poolDirectory,
      });

export function serveZoteroReadsWeb(
  scope: WorkerScope,
  options: WebRootOptions,
): void {
  serveWebApiReads(
    scope,
    {
      init: WebWorkerInitSchema,
      driver: (init) =>
        Effect.tryPromise({
          try: () => loadEngine(init),
          catch: toDbUnavailable,
        }).pipe(Effect.map((engine) => wasmReplicaDriver(engine))),
    },
    options,
  );
}
