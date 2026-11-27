import {
  builtModule,
  exported,
  floorConfig,
  floorOf,
  floorWasm,
  floorWorker,
  ROOTS,
} from "@scripts/__fixtures__/floor-worker.ts";
import { SQLITE_ENGINE_PIN } from "@scripts/__fixtures__/pack-pins.ts";
import { Effect } from "effect";
import type { Scope } from "effect";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { bytesRange, readPackEntry } from "@zotlit/resource-pack/reader.ts";
import { sha256Hex } from "@zotlit/resource-pack/sha256.ts";
import { writePack } from "@zotlit/resource-pack/writer.ts";
import { openScenarioApi } from "@zotlit/web-library/fake-zotero-api/scenario";
import type { WebWorkerPack } from "@zotlit/zotero-reads/client/web-worker.ts";

import {
  layerZoteroReadsWebWorker,
  ZoteroReadsWebWorker,
} from "./web-worker-client.ts";

const texts = vi.hoisted(() => ({ worker: "", temporal: "" }));
vi.mock("virtual:zotero-reads-web-worker", () => ({
  default: () => texts.worker,
}));
vi.mock("virtual:temporal-piece", () => ({ default: () => texts.temporal }));

beforeAll(async () => {
  const [worker, temporal] = await Promise.all(
    ROOTS.map(async (root) => exported(await builtModule(root))),
  );
  texts.worker = worker!;
  texts.temporal = temporal!;
}, 120_000);

async function packWithEngine(version: string): Promise<WebWorkerPack> {
  const bytes = await floorWasm();
  const pack = await writePack({
    entries: [
      {
        name: "sqlite-engine",
        bytes,
        sha256: await sha256Hex(bytes),
        upstreamVersion: version,
      },
    ],
  });
  return {
    locate: Effect.succeed({ version: "1.0.0", url: "app://pack/main.js" }),
    readEntry: (_location, name) =>
      Effect.promise(() => readPackEntry(bytesRange(pack), name)),
  };
}

const run = <A, E>(
  effect: Effect.Effect<A, E, ZoteroReadsWebWorker | Scope.Scope>,
) =>
  Effect.runPromise(
    Effect.scoped(effect).pipe(Effect.provide(layerZoteroReadsWebWorker)),
  );

describe("ZoteroReadsWebWorker", () => {
  it("reads the wasm of the Resource Pack's pinned SQLite engine and starts the Worker from the deflated texts of main.js", async () => {
    using scenario = openScenarioApi();
    const libraries = await run(
      Effect.gen(function* () {
        const service = yield* ZoteroReadsWebWorker;
        const read = yield* service.readWasm(
          yield* Effect.promise(() => packWithEngine(SQLITE_ENGINE_PIN)),
        );
        if (read.kind !== "ready") return yield* Effect.die(read.kind);
        const reads = yield* service.start(read.wasm, {
          config: floorConfig(scenario.key, "https://api.zotero.test"),
          storage: "memory",
          spawn: (url) => floorWorker(url, floorOf(), scenario.api),
        });
        yield* reads.Refresh();
        return yield* reads.Libraries({});
      }),
    );
    expect(libraries.length).toBeGreaterThan(1);
  }, 60_000);

  it("states that the pack is outdated for an engine older than the bundled glue", async () => {
    const read = await run(
      Effect.gen(function* () {
        const service = yield* ZoteroReadsWebWorker;
        return yield* service.readWasm(
          yield* Effect.promise(() => packWithEngine("3.48.0-build4")),
        );
      }),
    );
    expect(read).toEqual({ kind: "pack-outdated" });
  });

  it("fails the start with a typed error when a text of main.js does not inflate", async () => {
    const worker = texts.worker;
    texts.worker = "bm90IGRlZmxhdGVk";
    try {
      const error = await run(
        Effect.gen(function* () {
          const service = yield* ZoteroReadsWebWorker;
          return yield* Effect.flip(
            service.start(new Uint8Array(), {
              config: floorConfig(
                "unusedkey000000000000000",
                "http://127.0.0.1:9",
              ),
            }),
          );
        }),
      );
      expect(error._tag).toBe("WebWorkerCodeUnreadable");
    } finally {
      texts.worker = worker;
    }
  });
});
