import type { WebRootOptions } from "#worker/serve-web.ts";
import { it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect } from "vitest";

import type { StartWebWorkerOptions } from "./web-worker.ts";
import { startWebWorker } from "./web-worker.ts";

import { SEED } from "#__fixtures__/reads-seed.ts";
import { seededApi, webApiConfig } from "#__fixtures__/web-api.ts";
import { serveZoteroReadsWeb } from "#worker/serve-web.ts";

type HostWorker = ReturnType<NonNullable<StartWebWorkerOptions["spawn"]>>;

const wasm = () =>
  new Uint8Array(
    readFileSync(
      createRequire(import.meta.url).resolve(
        "@sqlite.org/sqlite-wasm/sqlite3.wasm",
      ),
    ),
  );

describe("the Web Worker client", () => {
  it.live(
    "answers other requests while a Changes stream is open",
    () =>
      Effect.gen(function* () {
        const api = seededApi(SEED, { userID: 42, username: "reader" });
        const { port1, port2 } = new MessageChannel();
        serveZoteroReadsWeb(
          {
            addEventListener: (type, listener) =>
              port2.addEventListener(type, listener),
            removeEventListener: (type, listener) =>
              port2.removeEventListener(type, listener),
            postMessage: (message) => port2.postMessage(message),
            close: () => port2.close(),
          },
          {
            fetch: api.fetch,
            queryJobs: undefined as unknown as WebRootOptions["queryJobs"],
          },
        );
        port2.start();
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            port1.close();
            port2.close();
          }),
        );
        const reads = yield* startWebWorker(
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
            spawn: () =>
              ({
                postMessage: (message: unknown, transfer?: Transferable[]) =>
                  port1.postMessage(message, transfer ?? []),
                addEventListener: (
                  type: string,
                  listener: EventListenerOrEventListenerObject,
                ) => {
                  port1.addEventListener(type, listener);
                  port1.start();
                },
                removeEventListener: (
                  type: string,
                  listener: EventListenerOrEventListenerObject,
                ) => port1.removeEventListener(type, listener),
                terminate: () => port1.close(),
              }) as unknown as HostWorker,
          },
        );
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
});
