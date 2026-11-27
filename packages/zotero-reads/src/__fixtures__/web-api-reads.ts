import { Effect, Layer } from "effect";

import { testReads } from "./reads.ts";
import type { TestReads } from "./reads.ts";
import { memoryWebApiSource } from "./web-api.ts";
import type { SeededApi } from "./web-api.ts";
import type { HandlersOptions } from "#worker/handlers.ts";
import { makeInProcessClient } from "#worker/in-process.ts";
import { layerUnpinnedConnectionItemSource } from "#worker/item-source.ts";
import { layerAbsentFileSystem } from "#worker/serve-web-api.ts";
import { sha256Hex } from "#worker/snapshot/sha256.ts";

export function webApiReadsService(
  seeded: SeededApi,
  handlers?: Partial<HandlersOptions>,
): TestReads {
  return testReads(
    Effect.gen(function* () {
      const services = yield* Layer.build(
        Layer.merge(memoryWebApiSource(seeded), layerAbsentFileSystem),
      );
      return yield* Effect.provideContext(
        makeInProcessClient({
          snapshotRevision: sha256Hex,
          itemSource: layerUnpinnedConnectionItemSource,
          ...handlers,
        }),
        services,
      );
    }),
  );
}
