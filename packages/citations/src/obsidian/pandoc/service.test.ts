import { it } from "@effect/vitest";
import { Effect, Exit, Scope } from "effect";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect } from "vitest";

import { packBinary } from "@zotlit/plugin-services/obsidian/managed-binary/__fixtures__.ts";
import {
  packDevice,
  packFile,
} from "@zotlit/plugin-services/obsidian/managed-binary/test-utils.ts";

import type { CitationEngine, PreparedDocument } from "./engine.ts";
import { PANDOC_ENGINE } from "./service.ts";

/**
 * The binary the Resource Pack holds, read from the `pandoc-wasm` dev
 * dependency. The package resolves through its `node` condition, so its entry
 * sits beside `pandoc.wasm`.
 */
const WASM_PATH = join(
  dirname(createRequire(import.meta.url).resolve("pandoc-wasm")),
  "pandoc.wasm",
);

const NOT_WASM = new Uint8Array(new TextEncoder().encode("not wasm"));

/** A device whose installed pack holds `binary` as the Pandoc Engine's entry. */
const device = Effect.fnUntraced(function* (binary: Uint8Array<ArrayBuffer>) {
  return packDevice(
    yield* Effect.promise(() => packFile({ [PANDOC_ENGINE.id]: binary })),
    "1.2.0",
  );
});

/** A prepared document that cites nothing, which no test here renders. */
const fakeDocument: PreparedDocument = {
  citedIds: [],
  withCitedIds: () => fakeDocument,
};

function fakeEngine(dispose: () => void): CitationEngine {
  return {
    renderBibliography: () => Promise.resolve([]),
    renderCitations: () => Promise.resolve([]),
    prepareDocument: () => Promise.resolve(fakeDocument),
    renderPrepared: () => Promise.resolve(new Uint8Array()),
    [Symbol.asyncDispose]: () => {
      dispose();
      return Promise.resolve();
    },
  };
}

describe("Pandoc Engine", () => {
  it.effect(
    "formats a reference with the binary of the pack",
    () =>
      Effect.gen(function* () {
        const service = yield* packBinary(
          PANDOC_ENGINE,
          yield* device(
            new Uint8Array(yield* Effect.promise(() => readFile(WASM_PATH))),
          ),
        );

        const engine = (yield* service.getEngine)!;
        const entries = yield* Effect.promise(() =>
          engine.renderBibliography({
            items: [
              {
                id: "rivers2020",
                type: "book",
                title: "Rivers of the world",
                author: [{ family: "Lee", given: "Ann" }],
                issued: { "date-parts": [[2020]] },
              },
            ],
          }),
        );

        expect(entries.map(({ id }) => id)).toEqual(["rivers2020"]);
        expect(yield* service.current).toEqual({
          kind: "ready",
          version: "1.2.0",
        });
      }).pipe(Effect.scoped),
    { timeout: 60_000 },
  );

  it.effect(
    "reads the pack for a status with no start of the engine, and fails the first borrow of a binary that does not start",
    () =>
      Effect.gen(function* () {
        const service = yield* packBinary(
          PANDOC_ENGINE,
          yield* device(NOT_WASM),
        );

        expect(yield* service.check).toEqual({
          kind: "ready",
          version: "1.2.0",
        });
        yield* Effect.flip(service.getEngine);
        expect(yield* service.current).toMatchObject({ kind: "failed" });
      }).pipe(Effect.scoped),
  );

  it.effect("hands out one engine and releases it with the service", () =>
    Effect.gen(function* () {
      let started = 0;
      let released = 0;
      const scope = yield* Scope.make();
      const service = yield* packBinary(
        {
          ...PANDOC_ENGINE,
          createEngine: () => {
            started += 1;
            return Promise.resolve(fakeEngine(() => (released += 1)));
          },
        },
        yield* device(NOT_WASM),
      ).pipe(Scope.provide(scope));

      const engine = yield* Effect.scoped(service.getEngine);
      expect(yield* Effect.scoped(service.getEngine)).toBe(engine);
      expect({ started, released }).toEqual({ started: 1, released: 0 });

      yield* Scope.close(scope, Exit.void);
      expect(released).toBe(1);
    }),
  );
});
