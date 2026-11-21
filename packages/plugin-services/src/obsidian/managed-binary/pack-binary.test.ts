import { it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { describe, expect } from "vitest";

import { captureLogRecords } from "@zotlit/plugin-kernel/__fixtures__/log-capture.ts";
import { PACK_COMPAT } from "@zotlit/resource-pack/format.ts";

import { openPackBinary } from "./__fixtures__.ts";
import type { PackBinary } from "./pack-binary.ts";
import { packDevice, packFile } from "./test-utils.ts";

const BINARY = new Uint8Array(new TextEncoder().encode("jieba wasm bytes"));

/** An engine that holds the bytes it started from. */
interface Started extends Disposable {
  readonly bytes: Uint8Array;
}

const SEGMENTER: PackBinary<Started> = {
  id: "chinese-segmenter",
  label: "Chinese segmenter",
  logCategory: ["managed-binary", "chinese-segmenter"],
  createEngine: (bytes) =>
    Promise.resolve({ bytes, [Symbol.dispose]: () => undefined }),
};

/** The status and the engine borrow of `binary` on a device with `file` installed. */
async function read(
  file: Uint8Array | null,
  binary: PackBinary<Started> = SEGMENTER,
) {
  await using opened = await openPackBinary(binary, packDevice(file, "1.2.0"));
  const { handle, service } = opened;
  const status = await handle.runPromise(service.check);
  const engine = await handle.runPromise(Effect.scoped(service.getEngine)).then(
    (started) => started && [...started.bytes],
    (error: unknown) => (error instanceof Error ? error.message : error),
  );
  return { status, engine };
}

describe("a Managed Binary of the Resource Pack", () => {
  it.effect("is ready from an installed pack and starts from its bytes", () =>
    Effect.promise(async () => {
      const file = await packFile({ "chinese-segmenter": BINARY });

      expect(await read(file)).toEqual({
        status: { kind: "ready", version: "1.2.0" },
        engine: [...BINARY],
      });
    }),
  );

  it.effect("reports no installed pack as pack-absent", () =>
    Effect.promise(async () => {
      expect(await read(null)).toEqual({
        status: { kind: "pack-absent" },
        engine: "The Resource Pack gave no Chinese segmenter: pack-absent",
      });
    }),
  );

  it.effect(
    "reports a pack below its compatibility integer as pack-outdated",
    () =>
      Effect.promise(async () => {
        const file = await packFile(
          { "chinese-segmenter": BINARY },
          PACK_COMPAT - 1,
        );

        expect(await read(file)).toEqual({
          status: { kind: "pack-outdated" },
          engine: "The Resource Pack gave no Chinese segmenter: pack-outdated",
        });
      }),
  );

  it.effect("reports a pack without the entry as pack-outdated", () =>
    Effect.promise(async () => {
      const file = await packFile({ "pandoc-engine": BINARY });

      expect((await read(file)).status).toEqual({ kind: "pack-outdated" });
    }),
  );

  it.effect(
    "reports a pack above its compatibility integer as plugin-outdated",
    () =>
      Effect.promise(async () => {
        const file = await packFile(
          { "chinese-segmenter": BINARY },
          PACK_COMPAT + 1,
        );

        expect(await read(file)).toEqual({
          status: { kind: "plugin-outdated" },
          engine:
            "The Resource Pack gave no Chinese segmenter: plugin-outdated",
        });
      }),
  );

  it.effect("reports a pack with a changed entry byte as pack-damaged", () =>
    Effect.promise(async () => {
      const file = await packFile({ "chinese-segmenter": BINARY });
      // The entry line is the last line of the file, before `*/`.
      const at = file.length - 8;
      file[at] = file[at] === 0x41 ? 0x42 : 0x41;

      expect(await read(file)).toEqual({
        status: { kind: "pack-damaged" },
        engine: "The Resource Pack gave no Chinese segmenter: pack-damaged",
      });
    }),
  );

  it.effect("reports a file that is no pack as pack-damaged", () =>
    Effect.promise(async () => {
      const file = new TextEncoder().encode("module.exports = {};\n");

      expect((await read(file)).status).toEqual({ kind: "pack-damaged" });
    }),
  );

  it.effect("logs each refusal of the pack with its reason", () =>
    Effect.promise(async () => {
      using logs = captureLogRecords();
      const device = packDevice(null);
      await using opened = await openPackBinary(SEGMENTER, device);
      const check = () => opened.handle.runPromise(opened.service.check);

      await check();
      device.install(
        await packFile({ "chinese-segmenter": BINARY }, PACK_COMPAT - 1),
      );
      await check();
      device.install(
        await packFile({ "chinese-segmenter": BINARY }, PACK_COMPAT + 1),
      );
      await check();
      device.install(new TextEncoder().encode("module.exports = {};\n"));
      await check();
      device.install(await packFile({ "chinese-segmenter": BINARY }));
      await check();

      expect(
        logs.records.map(({ level, rawMessage, properties }) => ({
          level,
          rawMessage,
          binary: properties["binary"],
          reason: properties["reason"],
        })),
      ).toEqual(
        (
          [
            ["info", "pack-absent"],
            ["warning", "pack-outdated"],
            ["warning", "plugin-outdated"],
            ["warning", "pack-unreadable"],
          ] as const
        ).map(([level, reason]) => ({
          level,
          rawMessage: "The Resource Pack gave no binary",
          binary: "chinese-segmenter",
          reason,
        })),
      );
    }),
  );

  it.effect("reports a verified binary that does not start as failed", () =>
    Effect.promise(async () => {
      const file = await packFile({ "chinese-segmenter": BINARY });
      await using opened = await openPackBinary(
        {
          ...SEGMENTER,
          createEngine: () => Promise.reject(new Error("Not a wasm module")),
        },
        packDevice(file),
      );
      const { handle, service } = opened;

      await expect(
        handle.runPromise(Effect.scoped(service.getEngine)),
      ).rejects.toThrow("Not a wasm module");
      const seen: unknown[] = [];
      await handle.runPromise(
        service.changes.pipe(
          Stream.take(1),
          Stream.runForEach((status) => Effect.sync(() => seen.push(status))),
        ),
      );
      expect(seen).toEqual([{ kind: "failed", detail: "Not a wasm module" }]);
    }),
  );

  it.effect(
    "starts the engine in a status read when the binary asks for it",
    () =>
      Effect.promise(async () => {
        const file = await packFile({ "chinese-segmenter": BINARY });
        await using opened = await openPackBinary(
          {
            ...SEGMENTER,
            startOnCheck: true,
            createEngine: () => Promise.reject(new Error("Not a wasm module")),
          },
          packDevice(file),
        );

        expect(await opened.handle.runPromise(opened.service.check)).toEqual({
          kind: "failed",
          detail: "Not a wasm module",
        });
      }),
  );

  it.effect(
    "names the entry of the installed pack, and none without a pack",
    () =>
      Effect.promise(async () => {
        const device = packDevice(null);
        await using opened = await openPackBinary(SEGMENTER, device);
        const { handle, service } = opened;

        expect(handle.runSync(service.entry)).toBeNull();
        device.install(new Uint8Array(), "1.3.0");
        expect(handle.runSync(service.entry)).toEqual({
          url: "app://device/plugins/zotlit-resources/main.js",
          entry: "chinese-segmenter",
          version: "1.3.0",
        });
      }),
  );
});
