import { Effect, Stream } from "effect";
import type { Layer } from "effect";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { USER_LIBRARY_ID } from "@zotlit/db";

import { buildEngineIndex, searchEngineIndex } from "./engine.ts";
import { makeIndexedItem as item } from "./fixtures.ts";
import {
  JIEBA_WASM_VERSION,
  layerSegmenterJieba,
  layerSegmenterNone,
  Segmenter,
  SegmenterUnavailable,
} from "./segmenter.ts";

const JIEBA_WASM = readFileSync(
  fileURLToPath(
    new URL("jieba_rs_wasm_bg.wasm", import.meta.resolve("jieba-wasm/web")),
  ),
);

const TITLE = "中华人民共和国宪法研究";

it("pins the bundled jieba-wasm version to the installed package version", () => {
  const manifest = new URL(
    "../../package.json",
    import.meta.resolve("jieba-wasm/web"),
  );
  const { version } = JSON.parse(readFileSync(manifest, "utf8")) as {
    version: string;
  };
  expect(JIEBA_WASM_VERSION).toBe(version);
});

describe("segmenter layers", () => {
  it("cut a CJK title differently", async () => {
    const none = await wordsOf(TITLE, layerSegmenterNone);
    const jieba = await wordsOf(TITLE, layerSegmenterJieba(JIEBA_WASM));

    expect(none).not.toContain("华人");
    expect(jieba).toEqual(
      expect.arrayContaining(["华人", "中华人民共和国宪法"]),
    );
  });

  it("let a query over jieba words hit only through the jieba layer", async () => {
    const target = item({ key: "A", title: TITLE });
    const search = (layer: Layer.Layer<Segmenter, SegmenterUnavailable>) =>
      Effect.gen(function* () {
        const index = yield* buildEngineIndex(Stream.make([target]), {
          libraries: [USER_LIBRARY_ID],
        });
        return yield* searchEngineIndex(index, "华人", { limit: 50 });
      }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(await search(layerSegmenterNone)).toEqual([]);
    expect(
      (await search(layerSegmenterJieba(JIEBA_WASM))).map((hit) => hit.itemID),
    ).toEqual([target.itemID]);
  });

  it("fail with SegmenterUnavailable on bytes that are not the binary", async () => {
    const error = await Effect.flip(
      wordsOfEffect(TITLE, layerSegmenterJieba(new Uint8Array([1, 2, 3]))),
    ).pipe(Effect.runPromise);

    expect(error).toBeInstanceOf(SegmenterUnavailable);
  });
});

function wordsOfEffect(
  text: string,
  layer: Layer.Layer<Segmenter, SegmenterUnavailable>,
) {
  return Effect.map(Effect.service(Segmenter), ({ words }) => words(text)).pipe(
    Effect.provide(layer),
  );
}

function wordsOf(
  text: string,
  layer: Layer.Layer<Segmenter, SegmenterUnavailable>,
): Promise<string[]> {
  return Effect.runPromise(wordsOfEffect(text, layer));
}
