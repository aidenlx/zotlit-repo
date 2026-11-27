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

export const ReplicaWorkerInitSchema = Schema.Struct({
  replicaPath: Schema.String,
  config: WebApiReadsConfigSchema,
  logs: Transferable.MessagePort,
});
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
  Schema.TaggedStruct("stopped", { message: Schema.String }),
  Schema.TaggedStruct("libraries-failed", {
    message: Schema.String,
    libraries: Schema.Array(
      Schema.Struct({ library: RemoteLibrarySchema, message: Schema.String }),
    ),
  }),
]);
export type WebSyncProblem = typeof WebSyncProblemSchema.Type;

export const ReplicaApplyTimesSchema = Schema.Struct({
  sequence: Schema.Int,
  beganAt: Schema.Finite,
  committedAt: Schema.Finite,
  applyMillis: Schema.Finite,
  closedMillis: Schema.Finite,
});
export type ReplicaApplyTimes = typeof ReplicaApplyTimesSchema.Type;

export const WebSyncProgressSchema = Schema.Union([
  Schema.Struct({
    phase: Schema.Literal("download"),
    done: Schema.Int,
    total: Schema.NullOr(Schema.Int),
  }),
  Schema.Struct({
    phase: Schema.Literal("apply"),
    done: Schema.Int,
    total: Schema.Int,
  }),
  Schema.Struct({ phase: Schema.Literal("waiting") }),
]);
export type WebSyncProgress = typeof WebSyncProgressSchema.Type;

export const WebSyncStatusSchema = Schema.Struct({
  state: Schema.Literals(["loading", "ready", "degraded"]),
  syncing: Schema.Boolean,
  syncId: Schema.NullOr(Schema.Int),
  waitingForReaders: Schema.Boolean,
  problem: Schema.NullOr(WebSyncProblemSchema),
  fileProblem: Schema.optional(WebSyncProblemSchema),
  progress: Schema.NullOr(WebSyncProgressSchema),
  zoteroLocale: Schema.NullOr(Schema.String),
  unconsentedUserID: Schema.NullOr(Schema.Int),
  rateWaitUntil: Schema.optional(Instant),
  lastApply: Schema.optional(ReplicaApplyTimesSchema),
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
  Rpc.make("SyncProgress", {
    success: Schema.NullOr(WebSyncProgressSchema),
    stream: true,
  }),
  Rpc.make("StopSync", {
    payload: { syncId: Schema.Int },
    success: Schema.Boolean,
  }),
) {}

export class ZoteroReadsWeb extends ZoteroReads.merge(ReplicaRequests) {}
