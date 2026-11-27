import { it } from "@effect/vitest";
import {
  builtModule,
  exported,
  floorOf,
  floorWasm,
  floorWorker,
  ROOTS,
} from "@scripts/__fixtures__/floor-worker.ts";
import { SQLITE_ENGINE_PIN } from "@scripts/__fixtures__/pack-pins.ts";
import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { beforeAll, describe, expect, vi } from "vitest";

import { MemoryDeviceStorage } from "@zotlit/obsidian-kit/__fixtures__/obsidian-device-storage.ts";
import { layerDeviceStorageFrom } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { databaseSettings } from "@zotlit/plugin-services/core/database/settings.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import {
  layerLibrarySource,
  LIBRARY_SOURCE_KEY,
  LibrarySource,
  WEB_API_KEY_SECRET_KEY,
} from "@zotlit/plugin-services/obsidian/library-source/service.ts";
import type { WebStart } from "@zotlit/plugin-services/obsidian/library-source/service.ts";
import { ResourcePackPlatform } from "@zotlit/plugin-services/obsidian/managed-binary/pack-platform.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
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

const API_URL = "https://api.zotero.test";

async function pack(): Promise<WebWorkerPack> {
  const bytes = await floorWasm();
  const written = await writePack({
    entries: [
      {
        name: "sqlite-engine",
        bytes,
        sha256: await sha256Hex(bytes),
        upstreamVersion: SQLITE_ENGINE_PIN,
      },
    ],
  });
  return {
    locate: Effect.succeed({ version: "1.0.0", url: "app://pack/main.js" }),
    readEntry: (_location, name) =>
      Effect.promise(() => readPackEntry(bytesRange(written), name)),
  };
}

const eventually = <A>(
  read: Effect.Effect<A, unknown>,
  done: (value: A) => boolean,
) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 600; attempt++) {
      const value = yield* Effect.option(read);
      if (value._tag === "Some" && done(value.value)) return value.value;
      yield* Effect.sleep("50 millis");
    }
    return yield* Effect.die("The condition did not hold in time");
  });

describe("the Zotero language through the online library", () => {
  it.live(
    "stores 01/02/2020 by the setting's language and stores it again after a change of the setting",
    () =>
      Effect.gen(function* () {
        const scenario = yield* Effect.acquireDisposable(
          Effect.sync(() => openScenarioApi()),
        );
        const library = scenario.api.user;
        const [key] = [...library.items.entries()].find(
          ([, stored]) => typeof stored.data.date === "string",
        )!;
        library.updateItem(key, { date: "01/02/2020" });
        const device = new MemoryDeviceStorage();
        device.saveLocalStorage(LIBRARY_SOURCE_KEY, "web-api");
        device.saveLocalStorage(WEB_API_KEY_SECRET_KEY, "zotero-reading-key");
        const secrets = new Map([["zotero-reading-key", scenario.key]]);
        const packed = yield* Effect.promise(() => pack());

        const dates = yield* Effect.gen(function* () {
          const settings = yield* SubscriptionRef.make<Readonly<Settings>>({
            ...databaseSettings.defaults,
            "zotero.language": "en-GB",
            "log.level": "info",
          } as Readonly<Settings>);
          const worker = yield* Effect.provide(
            Effect.map(ZoteroReadsWebWorker, (service) => service),
            layerZoteroReadsWebWorker,
          );
          const startWeb = Effect.fn(function* (
            config: Parameters<typeof worker.start>[1]["config"],
          ) {
            const read = yield* worker.readWasm(packed);
            if (read.kind !== "ready") return read;
            const client = yield* worker.start(read.wasm, {
              config,
              storage: "memory",
              spawn: (url) => floorWorker(url, floorOf(), scenario.api),
            });
            return { kind: "ready", client } satisfies WebStart;
          }, Effect.orDie);
          const context = yield* Layer.build(
            layerLibrarySource({
              startWeb,
              poolDirectory: Effect.succeed("/zotlit/language-test"),
              systemLanguage: Effect.succeed("en-US"),
              focused: Stream.make(true),
              webApiUrlOverride: Effect.succeed(API_URL),
              secrets: { getSecret: (id) => secrets.get(id) ?? null },
              removeStoredReplica: () => Effect.void,
              reload: Effect.void,
            }).pipe(
              Layer.provide([
                layerDeviceStorageFrom(device),
                Layer.mock(PluginSettings)({
                  current: SubscriptionRef.get(settings),
                  changes: SubscriptionRef.changes(settings),
                }),
                Layer.mock(ResourcePackPlatform)({
                  locate: Effect.succeed(null),
                  changes: Stream.never,
                }),
                Layer.succeed(
                  ObsidianEnv,
                  stubService<ObsidianEnv["Service"]>("ObsidianEnv", {
                    language: "en",
                  }),
                ),
              ]),
            ),
          );
          const source = Context.get(context, LibrarySource);
          const reads = source.reads!;
          const storedDate = Effect.map(
            reads.ItemsByIndexedKeys({ indexedKeys: [key] }),
            (items) =>
              (items.get(key)?.fields as { date?: string } | undefined)?.date,
          );
          const british = yield* eventually(storedDate, (date) =>
            Boolean(date),
          );
          yield* SubscriptionRef.update(settings, (current) => ({
            ...current,
            "zotero.language": "en-US",
          }));
          const american = yield* eventually(
            storedDate,
            (date) => Boolean(date) && date !== british,
          );
          return { british, american };
        });

        expect(dates.british).toBe("2020-02-01 01/02/2020");
        expect(dates.american).toBe("2020-01-02 01/02/2020");
      }).pipe(Effect.scoped),
    120_000,
  );
});
