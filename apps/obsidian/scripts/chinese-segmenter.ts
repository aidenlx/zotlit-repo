import type { Plugin } from "vite";

const GLUE_DEFAULT_URL = "new URL('jieba_rs_wasm_bg.wasm', import.meta.url)";

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
