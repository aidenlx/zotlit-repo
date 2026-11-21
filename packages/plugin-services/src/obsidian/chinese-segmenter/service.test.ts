import { it } from "@effect/vitest";
import { Effect } from "effect";
import { cut_for_search, initSync } from "jieba-wasm/web";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect } from "vitest";

import { CHINESE_SEGMENTER } from "./service.ts";

import { packBinary } from "#obsidian/managed-binary/__fixtures__.ts";
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

/** The Chinese Segmenter on a device whose installed pack holds `binary`. */
const segmenter = Effect.fnUntraced(function* (
  binary: Uint8Array<ArrayBuffer>,
) {
  const file = yield* Effect.promise(() =>
    packFile({ [CHINESE_SEGMENTER.id]: binary }),
  );
  return yield* packBinary(CHINESE_SEGMENTER, packDevice(file));
});

describe("Chinese Segmenter", () => {
  it.effect("cuts a Chinese title with the binary of the pack", () =>
    Effect.gen(function* () {
      const service = yield* segmenter(BINARY);

      const { module } = (yield* service.getEngine)!;
      initSync({ module });

      expect(cut_for_search("长江流域的城市化研究", true)).toEqual([
        "长江",
        "江流",
        "流域",
        "长江流域",
        "的",
        "城市",
        "城市化",
        "研究",
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("reports a binary of the pack that does not start as failed", () =>
    Effect.gen(function* () {
      const service = yield* segmenter(
        new Uint8Array(new TextEncoder().encode("not wasm")),
      );

      expect(yield* service.check).toMatchObject({ kind: "failed" });
    }).pipe(Effect.scoped),
  );
});
