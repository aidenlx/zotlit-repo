import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { Transferable } from "effect/workers";

import { Instant } from "./instant-codec.ts";
import { DbUnavailable, WebApiReadsConfigSchema, ZoteroReads } from "./rpc.ts";

export const WebWorkerInitSchema = Schema.Struct({
  wasm: Transferable.Uint8Array,
  storage: Schema.Literals(["opfs-sahpool", "memory"]),
  config: WebApiReadsConfigSchema,
  logs: Transferable.MessagePort,
});
export type WebWorkerInit = typeof WebWorkerInitSchema.Type;

const RemoteLibrarySchema = Schema.Struct({
  type: Schema.Literals(["user", "group"]),
  id: Schema.Int,
});

export const WebSyncProblemSchema = Schema.Union([
  Schema.TaggedStruct("key-invalid", { message: Schema.String }),
  Schema.TaggedStruct("no-access", { message: Schema.String }),
  Schema.TaggedStruct("account-changed", {
    message: Schema.String,
    consentedUserID: Schema.NullOr(Schema.Int),
    storedUserID: Schema.NullOr(Schema.Int),
    keyUserID: Schema.Int,
  }),
  Schema.TaggedStruct("network", { message: Schema.String }),
  Schema.TaggedStruct("rate-limited", { message: Schema.String }),
  Schema.TaggedStruct("protocol", { message: Schema.String }),
  Schema.TaggedStruct("storage", {
    reason: Schema.Literals(["full", "failed"]),
    message: Schema.String,
  }),
  Schema.TaggedStruct("libraries-failed", {
    message: Schema.String,
    libraries: Schema.Array(
      Schema.Struct({ library: RemoteLibrarySchema, message: Schema.String }),
    ),
  }),
]);
export type WebSyncProblem = typeof WebSyncProblemSchema.Type;

export const WebSyncStatusSchema = Schema.Struct({
  state: Schema.Literals(["loading", "ready", "degraded"]),
  syncing: Schema.Boolean,
  waitingForReaders: Schema.Boolean,
  problem: Schema.NullOr(WebSyncProblemSchema),
  progress: Schema.NullOr(
    Schema.Union([
      Schema.Struct({
        library: RemoteLibrarySchema,
        phase: Schema.Literals(["collections", "items"]),
        done: Schema.Int,
        total: Schema.Int,
      }),
      Schema.Struct({
        phase: Schema.Literal("apply"),
        done: Schema.Int,
        total: Schema.Int,
      }),
    ]),
  ),
  zoteroLocale: Schema.NullOr(Schema.String),
  unconsentedUserID: Schema.NullOr(Schema.Int),
  rateWaitUntil: Schema.optional(Instant),
  libraries: Schema.Array(
    Schema.Struct({
      library: RemoteLibrarySchema,
      committedVersion: Schema.NullOr(Schema.Int),
      lastSync: Schema.NullOr(Instant),
      retained: Schema.Struct({ deferred: Schema.Int, skipped: Schema.Int }),
    }),
  ),
});
export type WebSyncStatus = typeof WebSyncStatusSchema.Type;

export class ReplicaRequests extends RpcGroup.make(
  Rpc.make("SyncStatus", { success: WebSyncStatusSchema }),
  Rpc.make("RemoveReplica", { error: DbUnavailable }),
) {}

export class ZoteroReadsWeb extends ZoteroReads.merge(ReplicaRequests) {}
