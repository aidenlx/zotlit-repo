import type { WebRootOptions } from "#worker/serve-web-api.ts";
import { it } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect } from "vitest";

import { startWebWorker } from "./web-worker.ts";

import { SEED } from "#__fixtures__/reads-seed.ts";
import { seededApi, webApiConfig } from "#__fixtures__/web-api.ts";
import { workerChannel } from "#__fixtures__/worker-channel.ts";
import { serveZoteroReadsWeb } from "#worker/serve-web.ts";

const wasm = () =>
  new Uint8Array(
    readFileSync(
      createRequire(import.meta.url).resolve(
        "@sqlite.org/sqlite-wasm/sqlite3.wasm",
      ),
    ),
  );

const startReads = (api: ReturnType<typeof seededApi>) =>
  Effect.gen(function* () {
    const channel = yield* workerChannel;
    serveZoteroReadsWeb(channel.scope, {
      fetch: api.fetch,
      queryJobs: undefined as unknown as WebRootOptions["queryJobs"],
    });
    return yield* startWebWorker(
      {
        code: {
          source: new Blob(["/* worker */"]),
          temporal: new Blob(["/* temporal */"]),
        },
        wasm: wasm(),
      },
      {
        config: webApiConfig(api.key),
        storage: "memory",
        spawn: channel.spawn,
      },
    );
  });

describe("the Web Worker client", () => {
  it.live(
    "answers other requests while a Changes stream is open",
    () =>
      Effect.gen(function* () {
        const api = seededApi(SEED, { userID: 42, username: "reader" });
        const reads = yield* startReads(api);
        yield* Stream.runDrain(reads.Changes()).pipe(
          Effect.forkScoped({ startImmediately: true }),
        );
        yield* Effect.sleep("50 millis");
        const status = yield* reads
          .SyncStatus()
          .pipe(Effect.timeout("10 seconds"));
        expect(status.state).toBeDefined();
        yield* reads.Refresh().pipe(Effect.timeout("10 seconds"));
        const libraries = yield* reads
          .Libraries({})
          .pipe(Effect.timeout("10 seconds"));
        expect(libraries.length).toBeGreaterThan(0);
      }).pipe(Effect.scoped),
    30_000,
  );

  it.live(
    "pushes the download progress of a sync and stops it with StopSync",
    () =>
      Effect.gen(function* () {
        const api = seededApi(SEED, { userID: 42, username: "reader" });
        const reads = yield* startReads(api);
        yield* reads.Refresh().pipe(Effect.timeout("10 seconds"));
        api.api
          .library({ type: "user", id: 42 })
          .updateItem("MAIN2345", { title: "Changed before the stop" });
        const release = api.api.hold(
          (request) => request.query.itemKey !== undefined,
        );
        yield* Effect.addFinalizer(() => Effect.sync(release));
        const pushed: unknown[] = [];
        yield* Stream.runForEach(reads.SyncProgress(), (progress) =>
          Effect.sync(() => pushed.push(progress)),
        ).pipe(Effect.forkScoped({ startImmediately: true }));
        const refreshing = yield* Effect.forkChild(
          Effect.exit(reads.Refresh()),
          {
            startImmediately: true,
          },
        );
        const expected = { phase: "download", done: 0, total: null };
        for (
          let i = 0;
          i < 400 &&
          !pushed.some((p) => JSON.stringify(p) === JSON.stringify(expected));
          i++
        )
          yield* Effect.sleep("10 millis");
        expect(pushed).toContainEqual(expected);
        const { syncId } = yield* reads
          .SyncStatus()
          .pipe(Effect.timeout("10 seconds"));
        expect(
          yield* reads
            .StopSync({ syncId: syncId! })
            .pipe(Effect.timeout("10 seconds")),
        ).toBe(true);
        const stopped = yield* Fiber.join(refreshing).pipe(
          Effect.timeout("10 seconds"),
        );
        expect(stopped._tag).toBe("Failure");
        const status = yield* reads
          .SyncStatus()
          .pipe(Effect.timeout("10 seconds"));
        expect(status).toMatchObject({
          syncing: false,
          problem: { _tag: "stopped" },
        });
      }).pipe(Effect.scoped),
    30_000,
  );
});
