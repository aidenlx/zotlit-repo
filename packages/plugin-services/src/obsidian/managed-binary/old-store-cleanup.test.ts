// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { MemoryDeviceStorage } from "@zotlit/obsidian-kit/__fixtures__/obsidian-device-storage.ts";
import { layerDeviceStorageFrom } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { packBinary } from "./__fixtures__.ts";
import { removeOldStore } from "./old-store-cleanup.ts";
import type { PackBinary } from "./pack-binary.ts";
import { packNotice } from "./pack-notice.ts";
import { originFiles, packDevice, packFile } from "./test-utils.ts";
import type { OriginFolder } from "./test-utils.ts";

/** What a device holds after ZotLit downloaded both Managed Binaries. */
const downloaded = (): OriginFolder => ({
  zotlit: {
    "chinese-segmenter": { "6f1c.wasm": null },
    "pandoc-engine": { "b47c.wasm": null, "b47c.0d5e.part": null },
  },
});

/** A vault that dismissed both install offers of the old versions. */
function dismissedVault(): MemoryDeviceStorage {
  const storage = new MemoryDeviceStorage();
  storage.saveLocalStorage("zotlit-chinese-segmenter-declined", true);
  storage.saveLocalStorage("zotlit-pandoc-engine-declined", true);
  return storage;
}

/** One start of the plugin in the vault of `storage`, on the device `files`. */
const start = (
  storage: MemoryDeviceStorage,
  files: ReturnType<typeof originFiles>,
) =>
  removeOldStore(files.open).pipe(
    Effect.provide(layerDeviceStorageFrom(storage)),
  );

describe("the cleanup of the downloaded Managed Binaries", () => {
  it.effect(
    "removes the binary folder and the dismissed offers on the first start, and leaves the device alone on each later start",
    () =>
      Effect.gen(function* () {
        const storage = dismissedVault();
        const files = originFiles(downloaded());

        yield* start(storage, files);

        expect(files.paths()).toEqual([]);
        expect(
          storage.loadLocalStorage("zotlit-chinese-segmenter-declined"),
        ).toBeNull();
        expect(
          storage.loadLocalStorage("zotlit-pandoc-engine-declined"),
        ).toBeNull();

        const later = originFiles(downloaded());
        yield* start(storage, later);

        expect(later.opens).toBe(0);
        expect(later.paths()).toContain("zotlit/pandoc-engine/b47c.wasm");
      }),
  );

  it.effect("keeps what another owner put in the folder", () =>
    Effect.gen(function* () {
      const files = originFiles({
        zotlit: {
          ...downloaded().zotlit,
          "language-pack": { "zh.json": null },
        },
        other: { "data.bin": null },
      });

      yield* start(new MemoryDeviceStorage(), files);

      expect(files.paths()).toEqual([
        "zotlit",
        "zotlit/language-pack",
        "zotlit/language-pack/zh.json",
        "other",
        "other/data.bin",
      ]);
    }),
  );

  it.effect("reads a device with no binary folder one time", () =>
    Effect.gen(function* () {
      const storage = new MemoryDeviceStorage();
      const files = originFiles({});

      yield* start(storage, files);
      yield* start(storage, files);

      expect(files.opens).toBe(1);
      expect(files.paths()).toEqual([]);
    }),
  );

  it.effect(
    "removes the folder on the next start when the device refused the removal",
    () =>
      Effect.gen(function* () {
        const storage = new MemoryDeviceStorage();
        const files = originFiles(downloaded());
        files.refuse();

        yield* start(storage, files);
        expect(files.paths()).toContain("zotlit");

        yield* start(storage, files);
        expect(files.paths()).toEqual([]);
      }),
  );

  it.effect(
    "leaves a researcher who had a binary installed without it, with the notice, until the Resource Pack is installed",
    () =>
      Effect.gen(function* () {
        const bytes = new Uint8Array(new TextEncoder().encode("pandoc wasm"));
        const engine: PackBinary<Disposable> = {
          id: "pandoc-engine",
          label: "Pandoc engine",
          logCategory: ["pandoc", "engine"],
          createEngine: () =>
            Promise.resolve({ [Symbol.dispose]: () => undefined }),
        };
        const storage = dismissedVault();
        const device = packDevice(null);
        const notifier = testNotifier();
        const vault = Layer.merge(
          notifier.layer,
          layerDeviceStorageFrom(storage),
        );
        const service = yield* packBinary(engine, device);

        yield* start(storage, originFiles(downloaded()));
        const before = yield* service.check;
        yield* packNotice(before).pipe(Effect.provide(vault));
        const borrowed = yield* Effect.flip(service.getEngine);

        expect(before).toEqual({ kind: "pack-absent" });
        expect(borrowed.message).toBe(
          "The Resource Pack gave no Pandoc engine: pack-absent",
        );
        expect(
          notifier.notices.map(
            ({ messages }) => (messages[0] as DocumentFragment).textContent,
          ),
        ).toEqual([
          m.notice_resource_pack() + m.settings_resource_pack_status_absent(),
        ]);

        device.install(
          yield* Effect.promise(() => packFile({ "pandoc-engine": bytes })),
          "1.2.0",
        );

        expect(yield* service.check).toEqual({
          kind: "ready",
          version: "1.2.0",
        });
      }),
  );
});
