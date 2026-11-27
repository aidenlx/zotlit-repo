import { it } from "@effect/vitest";
import { Context, Effect, Exit, Fiber, Layer } from "effect";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect } from "vitest";

import { nodeReplicaDriver } from "./replica-driver-node.ts";

import { SEED } from "#__fixtures__/reads-seed.ts";
import { memoryWebApiSource, seededApi } from "#__fixtures__/web-api.ts";
import { REPLICA_FILE } from "#contract/web-worker.ts";
import { Connection } from "#worker/connection.ts";
import { WebLibrarySync } from "#worker/web-api-source.ts";

describe("the write-ahead log of the node:sqlite replica", () => {
  it.live(
    "is empty after an apply and after a download that the researcher stops",
    () =>
      Effect.gen(function* () {
        const api = seededApi(SEED, { userID: 42, username: "reader" });
        const folder = yield* Effect.acquireRelease(
          Effect.sync(() => mkdtempSync(join(tmpdir(), "zotlit-replica-wal-"))),
          (made) =>
            Effect.sync(() => rmSync(made, { recursive: true, force: true })),
        );
        const wal = join(folder, `${REPLICA_FILE}-wal`);
        const context = yield* Layer.build(
          memoryWebApiSource(api, {
            driver: Effect.succeed(nodeReplicaDriver(folder)),
          }),
        );
        const connection = Context.get(context, Connection);
        const sync = Context.get(context, WebLibrarySync);
        yield* connection.refresh;
        expect(statSync(wal).size).toBe(0);

        api.api
          .library({ type: "user", id: 42 })
          .updateItem("MAIN2345", { title: "Staged before the stop" });
        api.api
          .library({ type: "group", id: 900 })
          .updateItem("GRPITEMS", { title: "Held at the stop" });
        const held = (request: {
          path: string;
          query: { itemKey?: unknown };
        }) =>
          request.path === "/groups/900/items" &&
          request.query.itemKey !== undefined;
        const before = api.api.requests.filter(held).length;
        const release = api.api.hold(held);
        yield* Effect.addFinalizer(() => Effect.sync(release));
        const refreshing = yield* Effect.forkChild(
          Effect.exit(connection.refresh),
          { startImmediately: true },
        );
        yield* Effect.promise(() =>
          api.api.until((fake) => fake.requests.filter(held).length > before),
        );
        expect(statSync(wal).size).toBeGreaterThan(0);
        const { syncId } = yield* sync.status;
        expect(yield* sync.stopSync(syncId!)).toBe(true);
        expect(Exit.isFailure(yield* Fiber.join(refreshing))).toBe(true);
        expect(statSync(wal).size).toBe(0);
      }).pipe(Effect.scoped),
    30_000,
  );
});
