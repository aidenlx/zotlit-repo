import {
  REPLICA_WORKER,
  SNAPSHOT_INTEGRITY_WORKER,
} from "@zotlit/zotero-reads/contract/worker-signal.ts";

const entry =
  self.name === SNAPSHOT_INTEGRITY_WORKER
    ? import("./snapshot-integrity-worker.ts")
    : self.name === REPLICA_WORKER
      ? import("./replica-worker.ts")
      : import("./interactive-worker.ts");

void entry.catch((error: unknown) =>
  queueMicrotask(() => {
    throw error;
  }),
);
