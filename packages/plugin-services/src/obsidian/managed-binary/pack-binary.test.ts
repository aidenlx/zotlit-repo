import { it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { describe, expect } from "vitest";

import { captureLogRecords } from "@zotlit/plugin-kernel/__fixtures__/log-capture.ts";
import { PACK_COMPAT } from "@zotlit/resource-pack/format.ts";

import { packBinary } from "./__fixtures__.ts";
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

const NO_START: PackBinary<Started> = {
  ...SEGMENTER,
  createEngine: () => Promise.reject(new Error("Not a wasm module")),
};

/** The file of a pack that holds `entries`, at the compatibility integer `compat`. */
const pack = (
  entries: Readonly<Record<string, Uint8Array<ArrayBuffer>>>,
  compat?: number,
) => Effect.promise(() => packFile(entries, compat));

/**
 * The status of `binary` on a device with `file` installed, and what a borrow
 * of its engine gives: the bytes it started from, or the failure's message.
 */
const read = Effect.fnUntraced(function* (
  file: Uint8Array | null,
  binary: PackBinary<Started> = SEGMENTER,
) {
  const service = yield* packBinary(binary, packDevice(file, "1.2.0"));
  const status = yield* service.check;
  const engine = yield* service.getEngine.pipe(
    Effect.map((started) => started && [...started.bytes]),
    Effect.catch((error) => Effect.succeed(error.message)),
  );
  return { status, engine };
}, Effect.scoped);

describe("a Managed Binary of the Resource Pack", () => {
  it.effect("is ready from an installed pack and starts from its bytes", () =>
    Effect.gen(function* () {
      const file = yield* pack({ "chinese-segmenter": BINARY });

      expect(yield* read(file)).toEqual({
        status: { kind: "ready", version: "1.2.0" },
        engine: [...BINARY],
      });
    }),
  );

  it.effect("reports no installed pack as pack-absent", () =>
    Effect.gen(function* () {
      expect(yield* read(null)).toEqual({
        status: { kind: "pack-absent" },
        engine: "The Resource Pack gave no Chinese segmenter: pack-absent",
      });
    }),
  );

  it.effect(
    "reports a pack below its compatibility integer as pack-outdated",
    () =>
      Effect.gen(function* () {
        const file = yield* pack(
          { "chinese-segmenter": BINARY },
          PACK_COMPAT - 1,
        );

        expect(yield* read(file)).toEqual({
          status: { kind: "pack-outdated" },
          engine: "The Resource Pack gave no Chinese segmenter: pack-outdated",
        });
      }),
  );

  it.effect("reports a pack without the entry as pack-outdated", () =>
    Effect.gen(function* () {
      const file = yield* pack({ "pandoc-engine": BINARY });

      expect((yield* read(file)).status).toEqual({ kind: "pack-outdated" });
    }),
  );

  it.effect(
    "reports a pack above its compatibility integer as plugin-outdated",
    () =>
      Effect.gen(function* () {
        const file = yield* pack(
          { "chinese-segmenter": BINARY },
          PACK_COMPAT + 1,
        );

        expect(yield* read(file)).toEqual({
          status: { kind: "plugin-outdated" },
          engine:
            "The Resource Pack gave no Chinese segmenter: plugin-outdated",
        });
      }),
  );

  it.effect("reports a pack with a changed entry byte as pack-damaged", () =>
    Effect.gen(function* () {
      const file = yield* pack({ "chinese-segmenter": BINARY });
      // The entry line is the last line of the file, before `*/`.
      const at = file.length - 8;
      file[at] = file[at] === 0x41 ? 0x42 : 0x41;

      expect(yield* read(file)).toEqual({
        status: { kind: "pack-damaged" },
        engine: "The Resource Pack gave no Chinese segmenter: pack-damaged",
      });
    }),
  );

  it.effect("reports a file that is no pack as pack-damaged", () =>
    Effect.gen(function* () {
      const file = new TextEncoder().encode("module.exports = {};\n");

      expect((yield* read(file)).status).toEqual({ kind: "pack-damaged" });
    }),
  );

  it.effect("reports a verified binary that does not start as failed", () =>
    Effect.gen(function* () {
      const file = yield* pack({ "chinese-segmenter": BINARY });
      const service = yield* packBinary(NO_START, packDevice(file));

      const error = yield* Effect.flip(service.getEngine);
      expect(error.message).toBe("Not a wasm module");
      expect(yield* Stream.runHead(service.changes)).toMatchObject({
        value: { kind: "failed", detail: "Not a wasm module" },
      });
    }).pipe(Effect.scoped),
  );

  it.effect(
    "starts the engine in a status read when the binary asks for it",
    () =>
      Effect.gen(function* () {
        const file = yield* pack({ "chinese-segmenter": BINARY });
        const service = yield* packBinary(
          { ...NO_START, startOnCheck: true },
          packDevice(file),
        );

        expect(yield* service.check).toEqual({
          kind: "failed",
          detail: "Not a wasm module",
        });
      }).pipe(Effect.scoped),
  );

  it.effect(
    "names the entry of the installed pack, and none without a pack",
    () =>
      Effect.gen(function* () {
        const device = packDevice(null);
        const service = yield* packBinary(SEGMENTER, device);

        expect(yield* service.entry).toBeNull();
        device.install(new Uint8Array(), "1.3.0");
        expect(yield* service.entry).toEqual({
          url: "app://device/plugins/zotlit-resources/main.js",
          entry: "chinese-segmenter",
          version: "1.3.0",
        });
      }).pipe(Effect.scoped),
  );

  it.effect(
    "states where the binary stands with no read of the pack file",
    () =>
      Effect.gen(function* () {
        const device = packDevice(null);
        let reads = 0;
        const service = yield* packBinary(SEGMENTER, {
          ...device,
          open: (url) => {
            reads += 1;
            return device.open(url);
          },
        });

        // No pack: the installed plugins say so, and each watcher hears it.
        expect(yield* service.current).toEqual({ kind: "pack-absent" });
        expect(yield* Stream.runHead(service.changes)).toMatchObject({
          value: { kind: "pack-absent" },
        });
        // A pack installed since then is unread.
        device.install(yield* pack({ "chinese-segmenter": BINARY }), "1.3.0");
        expect(yield* service.current).toBeNull();
        expect(reads).toBe(0);

        yield* service.getEngine;
        expect(yield* service.current).toEqual({
          kind: "ready",
          version: "1.3.0",
        });
        expect(reads).toBe(1);
        device.install(null);
        expect(yield* service.current).toEqual({ kind: "pack-absent" });
      }).pipe(Effect.scoped),
  );

  it.effect("keeps the refusal of the last read until the next read", () =>
    Effect.gen(function* () {
      const device = packDevice(
        yield* pack({ "chinese-segmenter": BINARY }, PACK_COMPAT - 1),
      );
      const service = yield* packBinary(SEGMENTER, device);

      expect(yield* service.current).toBeNull();
      yield* Effect.flip(service.getEngine);
      expect(yield* service.current).toEqual({ kind: "pack-outdated" });
      device.install(yield* pack({ "chinese-segmenter": BINARY }));
      expect(yield* service.current).toEqual({ kind: "pack-outdated" });
      yield* service.check;
      expect(yield* service.current).toEqual({
        kind: "ready",
        version: "1.0.0",
      });
    }).pipe(Effect.scoped),
  );

  it.effect("logs each refusal of the pack with its reason", () =>
    Effect.gen(function* () {
      const logs = yield* Effect.acquireRelease(
        Effect.sync(() => captureLogRecords()),
        (captured) => Effect.sync(captured.release),
      );
      const device = packDevice(null);
      const service = yield* packBinary(SEGMENTER, device);

      yield* service.check;
      device.install(
        yield* pack({ "chinese-segmenter": BINARY }, PACK_COMPAT - 1),
      );
      yield* service.check;
      device.install(
        yield* pack({ "chinese-segmenter": BINARY }, PACK_COMPAT + 1),
      );
      yield* service.check;
      device.install(new TextEncoder().encode("module.exports = {};\n"));
      yield* service.check;
      device.install(yield* pack({ "chinese-segmenter": BINARY }));
      yield* service.check;

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
            // No pack is the state before its install, not a degraded one.
            ["debug", "pack-absent"],
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
    }).pipe(Effect.scoped),
  );
});
