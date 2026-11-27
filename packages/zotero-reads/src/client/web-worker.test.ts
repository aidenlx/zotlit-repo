import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Redacted, Scope } from "effect";
import { resolveObjectURL } from "node:buffer";

import {
  PACK_COMPAT,
  PACK_INDEX_BYTES,
  parseIndex,
} from "@zotlit/resource-pack/format.ts";
import { bytesRange, readPackEntry } from "@zotlit/resource-pack/reader.ts";
import { sha256Hex } from "@zotlit/resource-pack/sha256.ts";
import { writePack } from "@zotlit/resource-pack/writer.ts";
import type { PackSource } from "@zotlit/resource-pack/writer.ts";

import {
  readWebWorkerWasm,
  replicaDirectory,
  startWebWorker,
} from "./web-worker.ts";
import type { StartWebWorkerOptions, WebWorkerPack } from "./web-worker.ts";

import { TEMPORAL_PIECE_URL_GLOBAL } from "#contract/web-worker.ts";

const WASM = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);

async function entry(
  name: string,
  bytes: Uint8Array<ArrayBuffer>,
  upstreamVersion?: string,
): Promise<PackSource> {
  return { name, bytes, sha256: await sha256Hex(bytes), upstreamVersion };
}

const GLUE = "3.54.1-build1";

const engineEntry = () => entry("sqlite-engine", WASM, GLUE);

function packOver(pack: Uint8Array): WebWorkerPack {
  return {
    locate: Effect.succeed({ version: "1.0.0", url: "app://pack/main.js" }),
    readEntry: (_location, name) =>
      Effect.promise(() => readPackEntry(bytesRange(pack), name)),
  };
}

async function packOf(
  entries: readonly PackSource[],
  compat?: number,
): Promise<WebWorkerPack> {
  return packOver(await writePack({ entries, compat }));
}

const readOf = (pack: () => Promise<WebWorkerPack>) =>
  Effect.promise(() => pack()).pipe(
    Effect.flatMap((pack) => readWebWorkerWasm(pack, GLUE)),
  );

describe("readWebWorkerWasm", () => {
  it.effect("gives the wasm of a pack with the SQLite engine", () =>
    Effect.gen(function* () {
      const read = yield* readOf(async () => packOf([await engineEntry()]));
      expect(read.kind).toBe("ready");
      if (read.kind !== "ready") return;
      expect(Array.from(read.wasm)).toEqual(Array.from(WASM));
    }),
  );

  it.effect("states that the pack is absent when it is not installed", () =>
    Effect.gen(function* () {
      const read = yield* readWebWorkerWasm(
        {
          locate: Effect.succeed(null),
          readEntry: () => Effect.die("unreachable"),
        },
        GLUE,
      );
      expect(read).toEqual({ kind: "pack-absent" });
    }),
  );

  it.effect(
    "states that the pack is outdated when it lacks the SQLite engine",
    () =>
      Effect.gen(function* () {
        const read = yield* readOf(async () =>
          packOf([await entry("chinese-segmenter", WASM, "2.4.0")]),
        );
        expect(read).toEqual({ kind: "pack-outdated" });
      }),
  );

  it.effect.each([
    ["pack-outdated", "3.48.0-build4"],
    ["pack-outdated", "3.54.1-build0"],
    ["pack-outdated", undefined],
    ["plugin-outdated", "3.55.0-build1"],
    ["plugin-outdated", "3.54.1-build10"],
    ["pack-damaged", "garbage"],
    ["pack-damaged", "3.54.1"],
    ["pack-damaged", "03.54.1-build2"],
    ["pack-damaged", "3.054.1-build1"],
    ["pack-damaged", "3.54.1-build01"],
  ] as const)(
    `gives %s for an SQLite engine of version %s with the glue of ${GLUE}`,
    ([kind, version]) =>
      Effect.gen(function* () {
        const read = yield* readOf(async () =>
          packOf([await entry("sqlite-engine", WASM, version)]),
        );
        expect(read).toEqual({ kind });
      }),
  );

  it.effect(
    "states that the plugin is outdated for a pack of a newer format",
    () =>
      Effect.gen(function* () {
        const read = yield* readOf(async () =>
          packOf([await engineEntry()], PACK_COMPAT + 1),
        );
        expect(read).toEqual({ kind: "plugin-outdated" });
      }),
  );

  it.effect(
    "states that the pack is damaged when the SQLite engine fails its hash",
    () =>
      Effect.gen(function* () {
        const read = yield* readOf(async () => {
          const bytes = await writePack({ entries: [await engineEntry()] });
          const [engine] = parseIndex(
            bytes.subarray(0, PACK_INDEX_BYTES),
          )!.entries;
          const at = engine!.offset;
          bytes[at] = bytes[at] === 0x41 ? 0x42 : 0x41;
          return packOver(bytes);
        });
        expect(read).toEqual({ kind: "pack-damaged" });
      }),
  );
});

type HostWorker = ReturnType<NonNullable<StartWebWorkerOptions["spawn"]>>;

const textOf = (url: string) => resolveObjectURL(url)!.text();

describe("startWebWorker", () => {
  it.effect(
    "starts the Worker on its code, names the Temporal piece before it, and sends the initial message",
    () =>
      Effect.gen(function* () {
        const posted = yield* Deferred.make<unknown>();
        let spawnedAt = "";
        const standIn = {
          postMessage: (message: unknown) =>
            Deferred.doneUnsafe(posted, Effect.succeed(message)),
          addEventListener: (
            type: string,
            listener: (event: { data: unknown }) => void,
          ) => {
            if (type === "message")
              queueMicrotask(() => listener({ data: [0] }));
          },
          removeEventListener: () => {},
          terminate: () => {},
        } as unknown as HostWorker;
        const scope = yield* Scope.make();
        yield* startWebWorker(
          {
            code: {
              source: new Blob(["/* worker */"]),
              temporal: new Blob(["/* temporal */"]),
            },
            wasm: WASM.slice(),
          },
          {
            config: {
              source: "web-api",
              apiKey: Redacted.make("loaderkey000000000000000"),
              baseUrl: "https://api.zotero.test",
              poolDirectory: "/zotlit/loader",
              locale: null,
              chineseSegmenter: null,
              logLevel: null,
            },
            storage: "memory",
            spawn: (url) => {
              spawnedAt = url;
              return standIn;
            },
          },
        ).pipe(Scope.provide(scope));
        const init = yield* Deferred.await(posted);
        const worker = yield* Effect.promise(() => textOf(spawnedAt));
        const [prologue, source] = worker.split("\n");
        const piece = /= "(?<url>[^"]+)";$/.exec(prologue!)!.groups!.url!;
        expect(prologue).toBe(
          `self[${JSON.stringify(TEMPORAL_PIECE_URL_GLOBAL)}] = ${JSON.stringify(piece)};`,
        );
        expect(source).toBe("/* worker */");
        expect(yield* Effect.promise(() => textOf(piece))).toBe(
          "/* temporal */",
        );
        expect(JSON.stringify(init)).toContain('"memory"');
        yield* Scope.close(scope, Exit.void);
        expect(resolveObjectURL(spawnedAt)).toBeUndefined();
        expect(resolveObjectURL(piece)).toBeUndefined();
      }),
  );
});

describe("replicaDirectory", () => {
  it("gives each vault its own pool directory", () => {
    expect(replicaDirectory("a1b2c3d4e5f60718")).toBe(
      "/zotlit/a1b2c3d4e5f60718",
    );
  });
});
