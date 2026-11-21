import { it } from "@effect/vitest";
import { Effect, Option, Stream } from "effect";
import { describe, expect } from "vitest";

import { captureLogRecords } from "@zotlit/plugin-kernel/__fixtures__/log-capture.ts";
import {
  PACK_COMPAT,
  PACK_INDEX_BYTES,
  parseIndex,
} from "@zotlit/resource-pack/format.ts";

import { packBinary } from "./__fixtures__.ts";
import type {
  PackBinary,
  PackBinaryApi,
  PackBinaryStatus,
} from "./pack-binary.ts";
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

/** The first status of `kind` (and `version`) that `service` states. */
const nextStatus = (
  service: Pick<PackBinaryApi<Started>, "changes">,
  kind: PackBinaryStatus["kind"],
  version?: string,
) =>
  Stream.runHead(
    Stream.filter(
      service.changes,
      (status) =>
        status.kind === kind &&
        (version === undefined ||
          (status.kind === "ready" && status.version === version)),
    ),
  ).pipe(Effect.map((found) => Option.getOrThrow(found)));

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
    "keeps a failed start as the status of the same bytes in a later status read, until the pack gives other bytes",
    () =>
      Effect.gen(function* () {
        const device = packDevice(yield* pack({ "chinese-segmenter": BINARY }));
        const service = yield* packBinary(
          {
            ...SEGMENTER,
            createEngine: (bytes) =>
              bytes.length === BINARY.length
                ? Promise.reject(new Error("Not a wasm module"))
                : SEGMENTER.createEngine(bytes),
          },
          device,
        );
        const failed = { kind: "failed", detail: "Not a wasm module" };

        yield* Effect.flip(service.getEngine);
        // The settings row reads the status: the verified bytes still do not start.
        expect(yield* service.check).toEqual(failed);
        expect(yield* service.current).toEqual(failed);

        device.install(
          yield* pack({ "chinese-segmenter": new Uint8Array([1, 2, 3]) }),
          "1.3.0",
        );
        expect(yield* service.check).toEqual({
          kind: "ready",
          version: "1.3.0",
        });
      }).pipe(Effect.scoped),
  );

  it.effect(
    "joins status reads that run at the same time into one read of the pack and one start",
    () =>
      Effect.gen(function* () {
        const device = packDevice(yield* pack({ "chinese-segmenter": BINARY }));
        let reads = 0;
        let starts = 0;
        const service = yield* packBinary(
          {
            ...SEGMENTER,
            startOnCheck: true,
            createEngine: (bytes) => {
              starts += 1;
              return SEGMENTER.createEngine(bytes);
            },
          },
          {
            ...device,
            open: (url) => {
              const range = device.open(url);
              return (offset, length) => {
                // One read of an entry reads the index first.
                if (offset === 0) reads += 1;
                return range(offset, length);
              };
            },
          },
        );

        const statuses = yield* Effect.all(
          [service.check, service.check, service.check],
          { concurrency: "unbounded" },
        );

        expect(statuses).toEqual(
          Array.from({ length: 3 }, () => ({
            kind: "ready",
            version: "1.0.0",
          })),
        );
        expect({ reads, starts }).toEqual({ reads: 1, starts: 1 });
        // A status read after those ended reads the pack again.
        yield* service.check;
        expect({ reads, starts }).toEqual({ reads: 2, starts: 2 });
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
          sha256: null,
        });
      }).pipe(Effect.scoped),
  );

  it.effect(
    "names the entry by the hash its index states once a read verified it, so a repaired pack of the same version is another entry",
    () =>
      Effect.gen(function* () {
        const good = yield* pack({ "chinese-segmenter": BINARY });
        const stated = parseIndex(good.subarray(0, PACK_INDEX_BYTES))!
          .entries[0]!.sha256;
        const damaged = new TextEncoder().encode("module.exports = {};\n");
        const device = packDevice(damaged, "1.3.0");
        const service = yield* packBinary(SEGMENTER, device);
        const hashes: (string | null | undefined)[] = [];
        const note = Effect.map(service.entry, (entry) => {
          hashes.push(entry?.sha256);
        });

        yield* note; // unread
        yield* service.check;
        yield* note; // read, and refused as damaged
        device.install(good, "1.3.0");
        yield* service.check;
        yield* note; // the same version, repaired
        device.install(damaged, "1.3.0");
        yield* service.check;
        yield* note; // damaged again

        expect(hashes).toEqual([null, null, stated, null]);
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

  it.effect("follows a pack that Obsidian installs during the session", () =>
    Effect.gen(function* () {
      const device = packDevice(null);
      const service = yield* packBinary(SEGMENTER, device);
      expect(yield* service.current).toEqual({ kind: "pack-absent" });

      device.install(yield* pack({ "chinese-segmenter": BINARY }), "1.3.0");
      device.announce();

      expect(yield* nextStatus(service, "ready")).toEqual({
        kind: "ready",
        version: "1.3.0",
      });
    }).pipe(Effect.scoped),
  );

  it.effect("follows a pack that Obsidian removes during the session", () =>
    Effect.gen(function* () {
      const device = packDevice(yield* pack({ "chinese-segmenter": BINARY }));
      const service = yield* packBinary(SEGMENTER, device);
      yield* service.check;

      device.install(null);
      device.announce();

      expect(yield* nextStatus(service, "pack-absent")).toEqual({
        kind: "pack-absent",
      });
    }).pipe(Effect.scoped),
  );

  it.effect(
    "states the status of a pack that Obsidian replaces before any read",
    () =>
      Effect.gen(function* () {
        const device = packDevice(yield* pack({ "chinese-segmenter": BINARY }));
        const service = yield* packBinary(SEGMENTER, device);

        device.install(
          yield* pack({ "chinese-segmenter": BINARY }, PACK_COMPAT + 1),
        );
        device.announce();

        expect(yield* nextStatus(service, "plugin-outdated")).toEqual({
          kind: "plugin-outdated",
        });
      }).pipe(Effect.scoped),
  );

  it.effect(
    "starts the next borrow from the bytes of the pack that replaced the one its engine started from",
    () =>
      Effect.gen(function* () {
        const device = packDevice(yield* pack({ "chinese-segmenter": BINARY }));
        const service = yield* packBinary(SEGMENTER, device);
        const first = yield* Effect.scoped(
          Effect.map(
            service.getEngine,
            (engine) => engine && [...engine.bytes],
          ),
        );
        const newer = new Uint8Array([1, 2, 3]);

        device.install(yield* pack({ "chinese-segmenter": newer }), "1.3.0");
        device.announce();
        yield* nextStatus(service, "ready", "1.3.0");

        expect(first).toEqual([...BINARY]);
        expect([...((yield* service.getEngine)?.bytes ?? [])]).toEqual([
          1, 2, 3,
        ]);
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
