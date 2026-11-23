import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { makeSegmenterSwitch } from "./segmenter-switch.ts";
import { JIEBA_WASM_VERSION } from "./segmenter.ts";

const TITLE = "中华人民共和国宪法研究";
const ENTRY = "jieba_rs_wasm_bg.wasm";
const INVALID = { url: "invalid.zip", entry: ENTRY, version: "invalid" };
const VALID = { url: "valid.zip", entry: ENTRY, version: "valid" };

it("starts the Chinese Segmenter after an unsuitable first binary", async () => {
  const emptyModule = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
  const jieba = readFileSync(
    new URL(ENTRY, import.meta.resolve("jieba-wasm/web")),
  );
  const segmenter = makeSegmenterSwitch({
    read: ({ version }) =>
      Effect.succeed(
        version === VALID.version
          ? { bytes: jieba, upstreamVersion: JIEBA_WASM_VERSION }
          : { bytes: emptyModule, upstreamVersion: "2.3.0" },
      ),
  });
  expect(await Effect.runPromise(segmenter.resolve(INVALID))).toBeUndefined();
  expect(await Effect.runPromise(segmenter.status)).toEqual({
    kind: "pack-outdated",
  });

  const ready = await Effect.runPromise(segmenter.resolve(VALID));
  expect(await Effect.runPromise(segmenter.status)).toEqual({
    kind: "ready",
    version: VALID.version,
  });
  expect(ready?.words(TITLE)).toContain("华人");
});
