import type { WebRootOptions } from "#worker/serve-web-api.ts";
import type { WorkerScope } from "#worker/worker-launch.ts";
import { Effect } from "effect";
import { basename, dirname } from "node:path";

import { nodeReplicaDriver } from "./replica-driver-node.ts";

import { ReplicaWorkerInitSchema } from "#contract/web-worker-rpc.ts";
import { serveWebApiReads } from "#worker/serve-web-api.ts";

export function serveZoteroReadsReplica(
  scope: WorkerScope,
  options: WebRootOptions,
): void {
  serveWebApiReads(
    scope,
    {
      init: ReplicaWorkerInitSchema,
      driver: (init) =>
        Effect.sync(() => nodeReplicaDriver(dirname(init.replicaPath))),
      file: (init) => basename(init.replicaPath),
    },
    options,
  );
}
