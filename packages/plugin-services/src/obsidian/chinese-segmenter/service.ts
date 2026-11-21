// The Chinese Segmenter as a Managed Binary: the web-target `jieba-wasm` binary of the Resource Pack.

import type {
  PackBinary,
  PackBinaryApi,
} from "#obsidian/managed-binary/pack-binary.ts";
import { Context } from "effect";

import { layerPackBinary } from "#obsidian/managed-binary/pack-binary.ts";

/**
 * The verified binary, compiled. The ZoteroReads worker reads the entry from
 * the pack and instantiates the segmenter itself; the renderer compiles the
 * bytes only to prove they start.
 */
export interface ChineseSegmenterModule extends Disposable {
  readonly module: WebAssembly.Module;
}

/** The Chinese Segmenter's declaration; its Pack Entry is `chinese-segmenter`. */
export const CHINESE_SEGMENTER: PackBinary<ChineseSegmenterModule> = {
  id: "chinese-segmenter",
  label: "Chinese segmenter",
  logCategory: ["item-lookup", "segmenter"],
  createEngine: async (binary) => ({
    module: await WebAssembly.compile(binary),
    // A compiled module holds no instance and no memory to release.
    [Symbol.dispose]: () => undefined,
  }),
  startOnCheck: true,
};

export class ChineseSegmenter extends Context.Service<
  ChineseSegmenter,
  PackBinaryApi<ChineseSegmenterModule>
>()("zotlit/chinese-segmenter/ChineseSegmenter") {}

export const layerChineseSegmenter = layerPackBinary(
  ChineseSegmenter,
  CHINESE_SEGMENTER,
);
