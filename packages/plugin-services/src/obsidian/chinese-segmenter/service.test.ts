import { it } from "@effect/vitest";
import { Effect } from "effect";
import { cut_for_search, initSync } from "jieba-wasm/web";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect } from "vitest";

import { CHINESE_SEGMENTER } from "./service.ts";

import { openPackBinary } from "#obsidian/managed-binary/__fixtures__.ts";
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

describe("Chinese Segmenter", () => {
  it.effect("cuts a Chinese title with the binary of the pack", () =>
    Effect.promise(async () => {
      const file = await packFile({ [CHINESE_SEGMENTER.id]: BINARY });
      await using segmenter = await openPackBinary(
        CHINESE_SEGMENTER,
        packDevice(file),
      );

      const { module } = (await segmenter.handle.runPromise(
        Effect.scoped(segmenter.service.getEngine),
      ))!;
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
    }),
  );

  it.effect("reports a binary of the pack that does not start as failed", () =>
    Effect.promise(async () => {
      const file = await packFile({
        [CHINESE_SEGMENTER.id]: new Uint8Array(
          new TextEncoder().encode("not wasm"),
        ),
      });
      await using segmenter = await openPackBinary(
        CHINESE_SEGMENTER,
        packDevice(file),
      );

      expect(
        await segmenter.handle.runPromise(segmenter.service.check),
      ).toMatchObject({ kind: "failed" });
    }),
  );
});
