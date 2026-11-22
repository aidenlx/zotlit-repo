import { Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { DatabaseSync } from "node:sqlite";

import { DbUnavailable } from "#contract/db-unavailable.ts";

export const SnapshotIntegrity = RpcGroup.make(
  Rpc.make("Check", {
    payload: { path: Schema.String },
    error: DbUnavailable,
  }),
);

export function snapshotFailure(error: unknown): DbUnavailable {
  return new DbUnavailable({
    message: error instanceof Error ? error.message : String(error),
  });
}

export const verifySnapshotInProcess = Effect.fnUntraced(function* (
  path: string,
): Effect.fn.Return<void, DbUnavailable> {
  const result = yield* Effect.try({
    try: () => {
      using sqlite = new DatabaseSync(path, {
        readOnly: true,
        timeout: 1_000,
      });
      return sqlite.prepare("PRAGMA integrity_check").get()?.integrity_check;
    },
    catch: snapshotFailure,
  });
  if (result !== "ok")
    return yield* new DbUnavailable({
      message: "SQLite rejected the database read snapshot",
    });
});
