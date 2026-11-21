// The build's treatment of the `jieba-wasm` web glue. The binary itself ships
// in the Resource Pack (`apps/resources`), which pins it.

import type { Plugin } from "vite";

/** The default load path of the `jieba-wasm` web glue: its binary, beside it. */
const GLUE_DEFAULT_URL = "new URL('jieba_rs_wasm_bg.wasm', import.meta.url)";

/**
 * Keeps the `jieba-wasm` web glue from inlining its binary. The glue's
 * default loader names `jieba_rs_wasm_bg.wasm` beside itself, and a library
 * build inlines that asset, about 5 MB, into the bundle. The segmenter never
 * takes that path: it starts from the binary of the Resource Pack through
 * `initSync`. The rewrite marks the URL, so Vite leaves it as written.
 */
export function chineseSegmenterGlue(): Plugin {
  return {
    name: "chinese-segmenter-glue",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("/jieba-wasm/pkg/web/jieba_rs_wasm.js")) return null;
      if (!code.includes(GLUE_DEFAULT_URL))
        this.error(
          `The jieba-wasm web glue no longer loads ${GLUE_DEFAULT_URL}; update chineseSegmenterGlue.`,
        );
      return {
        code: code.replace(
          GLUE_DEFAULT_URL,
          "new URL(/* @vite-ignore */ 'jieba_rs_wasm_bg.wasm', import.meta.url)",
        ),
        map: null,
      };
    },
  };
}
