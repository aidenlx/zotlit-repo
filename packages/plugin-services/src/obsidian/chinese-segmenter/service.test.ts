import { it } from "@effect/vitest";
import { Context, Effect, Layer, Option, Stream } from "effect";
import { RpcClientError } from "effect/rpc";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect } from "vitest";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsApi } from "@zotlit/zotero-reads/client/service.ts";

import { layerDeviceSegmenter } from "./__fixtures__.ts";
import { ChineseSegmenter } from "./service.ts";

import { packDevice, packFile } from "#obsidian/managed-binary/test-utils.ts";

/** The web-target binary the Resource Pack holds, read from the `jieba-wasm` dev dependency. */
const BINARY = new Uint8Array(
  await readFile(
    join(
      dirname(createRequire(import.meta.url).resolve("jieba-wasm/web")),
      "jieba_rs_wasm_bg.wasm",
    ),
  ),
);

const pack = (binary: Uint8Array<ArrayBuffer>) =>
  Effect.promise(() => packFile({ "chinese-segmenter": binary }));

/** The Chinese Segmenter on `device`, over `reads` or a worker that reads the device's pack. */
const segmenterOn = (
  device: ReturnType<typeof packDevice>,
  reads?: Layer.Layer<ZoteroReads>,
) =>
  Effect.map(Layer.build(layerDeviceSegmenter(device, reads)), (context) =>
    Context.get(context, ChineseSegmenter),
  );

describe("Chinese Segmenter", () => {
  it.effect(
    "states the status the worker gives for the binary of the pack",
    () =>
      Effect.gen(function* () {
        const service = yield* segmenterOn(packDevice(yield* pack(BINARY)));

        expect(yield* service.current).toBeNull();
        expect(yield* service.check).toEqual({
          kind: "ready",
          version: "1.0.0",
        });
        expect(yield* service.current).toEqual({
          kind: "ready",
          version: "1.0.0",
        });
      }).pipe(Effect.scoped),
  );

  it.effect("reports a binary of the pack that does not start as failed", () =>
    Effect.gen(function* () {
      const service = yield* segmenterOn(
        packDevice(yield* pack(new TextEncoder().encode("not wasm"))),
      );

      expect(yield* service.check).toMatchObject({ kind: "failed" });
    }).pipe(Effect.scoped),
  );

  it.effect(
    "asks the worker again and states the new status when Obsidian changes the pack",
    () =>
      Effect.gen(function* () {
        const device = packDevice(null);
        const service = yield* segmenterOn(device);
        expect(yield* service.check).toEqual({ kind: "pack-absent" });

        device.install(yield* pack(BINARY));
        device.announce();

        expect(
          yield* Stream.runHead(
            Stream.filter(
              service.changes,
              ({ kind }) => kind !== "pack-absent",
            ),
          ),
        ).toEqual(Option.some({ kind: "ready", version: "1.0.0" }));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "starts the binary in the worker when Obsidian installs the same version over a damaged pack",
    () =>
      Effect.gen(function* () {
        const device = packDevice(
          new TextEncoder().encode("module.exports = {};\n"),
        );
        const service = yield* segmenterOn(device);
        expect(yield* service.check).toEqual({ kind: "pack-damaged" });

        device.install(yield* pack(BINARY));
        device.announce();

        expect(
          yield* Stream.runHead(
            Stream.filter(
              service.changes,
              ({ kind }) => kind !== "pack-damaged",
            ),
          ),
        ).toEqual(Option.some({ kind: "ready", version: "1.0.0" }));
      }).pipe(Effect.scoped),
  );

  it.effect.each([
    ["an installed pack as failed", BINARY, "failed"],
    ["no pack as pack-absent", null, "pack-absent"],
  ] as const)("reads a worker that does not answer with %s", ([, file, kind]) =>
    Effect.gen(function* () {
      const service = yield* segmenterOn(
        packDevice(file && (yield* pack(file))),
        Layer.mock(ZoteroReads, {
          reads: stubService<ZoteroReadsApi>("ZoteroReadsApi", {
            CheckChineseSegmenter: () =>
              Effect.fail(
                new RpcClientError.RpcClientError({
                  reason: new RpcClientError.RpcClientDefect({
                    message: "No database worker",
                    cause: undefined,
                  }),
                }),
              ),
          }),
        }),
      );

      expect(yield* service.check).toMatchObject({ kind });
    }).pipe(Effect.scoped),
  );
});
