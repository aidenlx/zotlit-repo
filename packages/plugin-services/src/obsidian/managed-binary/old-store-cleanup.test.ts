// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { MemoryDeviceStorage } from "@zotlit/obsidian-kit/__fixtures__/obsidian-device-storage.ts";
import { layerDeviceStorageFrom } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";

import { originFiles } from "./__fixtures__.ts";
import type { OriginFolder } from "./__fixtures__.ts";
import { removeOldStore } from "./old-store-cleanup.ts";

const downloaded = (): OriginFolder => ({
  zotlit: {
    "chinese-segmenter": { "6f1c.wasm": null },
    "pandoc-engine": { "b47c.wasm": null, "b47c.0d5e.part": null },
  },
});

function dismissedVault(): MemoryDeviceStorage {
  const storage = new MemoryDeviceStorage();
  storage.saveLocalStorage("zotlit-chinese-segmenter-declined", true);
  storage.saveLocalStorage("zotlit-pandoc-engine-declined", true);
  return storage;
}

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

        const first = yield* start(storage, files);

        expect(first).toBe("removed");
        expect(files.paths()).toEqual([]);
        expect(
          storage.loadLocalStorage("zotlit-chinese-segmenter-declined"),
        ).toBeNull();
        expect(
          storage.loadLocalStorage("zotlit-pandoc-engine-declined"),
        ).toBeNull();

        const later = originFiles(downloaded());
        const second = yield* start(storage, later);

        expect(second).toBe("skipped");
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

        const refused = yield* start(storage, files);
        expect(refused).toBe("failed");
        expect(files.paths()).toContain("zotlit");

        const next = yield* start(storage, files);
        expect(next).toBe("removed");
        expect(files.paths()).toEqual([]);
      }),
  );
});
