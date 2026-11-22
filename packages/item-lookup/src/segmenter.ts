import { Context, Effect, Layer, Schema } from "effect";
import { cut_for_search, initSync } from "jieba-wasm/web";

import { tokenize } from "./tokenizer.ts";

export class Segmenter extends Context.Service<
  Segmenter,
  {
    readonly words: (text: string) => string[];
  }
>()("zotlit/item-lookup/Segmenter") {}

export class SegmenterUnavailable extends Schema.TaggedError<SegmenterUnavailable>()(
  "SegmenterUnavailable",
  { message: Schema.String },
) {}

export const layerSegmenterNone: Layer.Layer<Segmenter> = Layer.sync(
  Segmenter,
  () => {
    const intl = wordSegmenter();
    return { words: (text) => tokenize(text, { intl }) };
  },
);

export function layerSegmenterJieba(
  wasm: BufferSource,
): Layer.Layer<Segmenter, SegmenterUnavailable> {
  return Layer.effect(
    Segmenter,
    Effect.tryPromise({
      try: () => WebAssembly.compile(wasm),
      catch: (cause) => unavailable(cause),
    }).pipe(
      Effect.flatMap((module) =>
        Effect.try({
          try: () => initSync({ module }),
          catch: (cause) => unavailable(cause),
        }),
      ),
      Effect.as(jiebaSegmenter()),
    ),
  );
}

const CJK_RUN = /([\u4e00-\u9fa5]+)/u;

export const hasChineseRun = (text: string): boolean => CJK_RUN.test(text);

function jiebaSegmenter(): (typeof Segmenter)["Service"] {
  const intl = wordSegmenter();
  return {
    words: (text) =>
      text
        .split(CJK_RUN)
        .flatMap((part, position) =>
          position % 2 === 1
            ? cut_for_search(part, true)
            : tokenize(part, { intl }),
        ),
  };
}

function wordSegmenter(): Intl.Segmenter {
  return new Intl.Segmenter(undefined, { granularity: "word" });
}

function unavailable(cause: unknown): SegmenterUnavailable {
  return new SegmenterUnavailable({
    message: cause instanceof Error ? cause.message : String(cause),
  });
}
