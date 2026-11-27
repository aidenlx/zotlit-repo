import type {
  Context,
  Emitter,
  FS,
  PartialScope,
  TagToken,
  Template,
  TopLevelToken,
  ValueToken,
} from "liquidjs";
import { evalToken, filters, Liquid, Tag, tags, toValue } from "liquidjs";

import { formatBlockquote } from "./blockquote.ts";
import { coerceOutput } from "./coerce.ts";
import { filenameSuffix } from "./filename-suffix.ts";
import { isItemDateLike, toLiquidDate } from "./liquid-date.ts";
import { normalizeObsidianTag } from "./obsidian-tag.ts";
import { formatTemplatePandocCitation } from "./pandoc-citation-adapter.ts";
import { formatTemplateTexCitation } from "./tex-citation-adapter.ts";

export { ParseError, TokenizationError } from "liquidjs";

export const LIQUID_BUILTIN_FILTER_NAMES: readonly string[] = Object.freeze(
  Object.keys(filters).sort(),
);

export const LIQUID_BUILTIN_TAG_NAMES: readonly string[] = Object.freeze(
  Object.keys(tags).sort(),
);

const FLATTEN_FILTER_NAME = "flatten";

export const ZOTLIT_FILTER_NAMES: readonly string[] = Object.freeze([
  "embed",
  "file_link",
  "note_link",
  "img_link",
  "note_links",
  "collection_paths",
  "arr_prefix",
  "arr_suffix",
  "arr_replace",
  FLATTEN_FILTER_NAME,
  "obsidian_tag",
  "pandoc_cite",
  "tex_cite",
]);

export const ZOTLIT_TAG_NAMES: readonly string[] = Object.freeze([
  "bq",
  "endbq",
  "render_annotation",
  "suffix",
]);

function registerLinkFilter(
  engine: Liquid,
  filterName: string,
  methodName: string,
): void {
  engine.registerFilter(
    filterName,
    (obj: unknown, alias?: string, subpath?: string) => {
      const helper = (obj as Record<string, unknown> | null | undefined)?.[
        methodName
      ];
      return typeof helper === "function"
        ? (helper as (alias?: string, subpath?: string) => unknown).call(
            obj,
            alias,
            subpath,
          )
        : null;
    },
  );
}

function tagName(item: unknown): string {
  if (typeof item === "string") return item;
  if (typeof item === "number") return String(item);
  const name = (item as { name?: unknown } | null | undefined)?.name;
  return typeof name === "string" ? name : "";
}

function noteLinkOrError(item: unknown): unknown {
  const record = item as Record<string, unknown> | null | undefined;
  const noteLink = record?.noteLink;
  const link =
    typeof noteLink === "function"
      ? (noteLink as () => unknown).call(record)
      : null;
  return link ?? `zt-error:${String(record?.indexedKey)}`;
}

class BqTag extends Tag {
  readonly #tpls: Template[] = [];

  constructor(
    tagToken: TagToken,
    remainTokens: TopLevelToken[],
    liquid: Liquid,
  ) {
    super(tagToken, remainTokens, liquid);
    liquid.parser
      .parseStream(remainTokens)
      .on("template", (tpl: Template) => this.#tpls.push(tpl))
      .on("tag:endbq", function (this: { stop(): void }) {
        this.stop();
      })
      .on("end", () => {
        throw new Error(`tag ${tagToken.getText()} not closed`);
      })
      .start();
  }

  *render(ctx: Context, emitter: Emitter): Generator<unknown, void, unknown> {
    const html = (yield this.liquid.renderer.renderTemplates(
      this.#tpls,
      ctx,
    )) as string;
    emitter.write(formatBlockquote(html));
  }
}

class SuffixTag extends Tag {
  readonly #args: ValueToken[] = [];

  constructor(
    tagToken: TagToken,
    remainTokens: TopLevelToken[],
    liquid: Liquid,
  ) {
    super(tagToken, remainTokens, liquid);
    while (!this.tokenizer.end()) {
      const value = this.tokenizer.readValue();
      if (value) this.#args.push(value);
      this.tokenizer.readTo(",");
    }
  }

  *render(ctx: Context, emitter: Emitter): Generator<unknown, void, unknown> {
    const [lengthTok, prependTok, appendTok] = this.#args;
    const length = lengthTok
      ? ((yield evalToken(lengthTok, ctx)) as number | undefined)
      : undefined;
    const prepend = prependTok
      ? ((yield evalToken(prependTok, ctx)) as string | undefined)
      : undefined;
    const append = appendTok
      ? ((yield evalToken(appendTok, ctx)) as string | undefined)
      : undefined;
    emitter.write(filenameSuffix(length, prepend, append));
  }
}

class RenderAnnotationTag extends Tag {
  readonly #annotation: ValueToken;

  constructor(
    tagToken: TagToken,
    remainTokens: TopLevelToken[],
    liquid: Liquid,
  ) {
    super(tagToken, remainTokens, liquid);
    const annotation = this.tokenizer.readValue();
    if (!annotation || this.tokenizer.remaining().trim() !== "") {
      throw new Error("render_annotation requires one annotation argument");
    }
    this.#annotation = annotation;
  }

  *render(ctx: Context, emitter: Emitter): Generator<unknown, void, unknown> {
    const annotation = toValue(yield evalToken(this.#annotation, ctx));
    if (annotation == null) {
      throw new TypeError("render_annotation requires an annotation");
    }
    const childCtx = ctx.spawn();
    childCtx.bottom().zt = annotation;
    const templates = (yield this.liquid._parsePartialFile(
      "annotation",
      childCtx.sync,
      this.token.file,
    )) as Template[];
    yield this.liquid.renderer.renderTemplates(templates, childCtx, emitter);
  }

  arguments(): ValueToken[] {
    return [this.#annotation];
  }

  *children(partials: boolean, sync: boolean): Generator<unknown, Template[]> {
    return partials
      ? yield this.liquid._parsePartialFile("annotation", sync, this.token.file)
      : [];
  }

  partialScope(): PartialScope {
    return {
      name: "annotation",
      isolated: true,
      scope: [["zt", this.#annotation]],
    };
  }
}

export interface CreateLiquidEngineOptions {
  fs?: FS;
}

export function createLiquidEngine({
  fs,
}: CreateLiquidEngineOptions = {}): Liquid {
  const engine = new Liquid({
    ...(fs ? { fs } : {}),
    greedy: false,
    relativeReference: false,
    outputEscape: coerceOutput,
    strictFilters: true,
  });

  engine.registerTag("bq", BqTag);
  engine.registerTag("render_annotation", RenderAnnotationTag);

  engine.registerFilter("embed", (link: unknown): string =>
    typeof link === "string" && link !== "" ? `!${link}` : "",
  );

  registerLinkFilter(engine, "file_link", "fileLink");
  registerLinkFilter(engine, "note_link", "noteLink");
  registerLinkFilter(engine, "img_link", "imgLink");

  engine.registerFilter("note_links", (items: unknown): unknown[] =>
    Array.isArray(items) ? items.map(noteLinkOrError) : [],
  );
  engine.registerFilter(
    "collection_paths",
    (collections: unknown, sep = "/"): unknown[] =>
      Array.isArray(collections)
        ? collections.map((c: unknown) =>
            (c as { path: string[] }).path.join(sep),
          )
        : [],
  );

  engine.registerFilter("arr_prefix", (items: unknown, str?: string) => {
    if (!Array.isArray(items))
      throw new TypeError("arr_prefix requires an array");
    return items.map((item) => `${str ?? ""}${String(item)}`);
  });

  engine.registerFilter("arr_suffix", (items: unknown, str?: string) => {
    if (!Array.isArray(items))
      throw new TypeError("arr_suffix requires an array");
    return items.map((item) => `${String(item)}${str ?? ""}`);
  });

  engine.registerFilter(
    "arr_replace",
    (items: unknown, search?: string, replacement?: string) => {
      if (!Array.isArray(items))
        throw new TypeError("arr_replace requires an array");
      if (!search) throw new TypeError("arr_replace requires a search string");
      return items.map((item) =>
        String(item).replaceAll(search, replacement ?? ""),
      );
    },
  );

  engine.registerFilter(FLATTEN_FILTER_NAME, flatten);

  engine.registerFilter("obsidian_tag", (value: unknown, prefix?: string) => {
    const prefixed = (item: unknown): string => {
      const body = normalizeObsidianTag(tagName(item));
      return body === "" ? "" : `${prefix ?? ""}${body}`;
    };
    return Array.isArray(value)
      ? value.map(prefixed).filter((tag) => tag !== "")
      : prefixed(value);
  });

  engine.registerFilter("pandoc_cite", formatTemplatePandocCitation);
  engine.registerFilter("tex_cite", formatTemplateTexCitation);

  engine.registerTag("suffix", SuffixTag);

  const builtinDate = filters.date as (
    this: unknown,
    v: unknown,
    ...args: unknown[]
  ) => unknown;
  engine.registerFilter(
    "date",
    function (this: unknown, v: unknown, ...args: unknown[]) {
      if (isItemDateLike(v) && v.kind === "text") return String(v);
      return builtinDate.call(this, toLiquidDate(v), ...args);
    },
  );

  return engine;
}

function flatten(items: unknown, depth = 1): unknown[] {
  if (!Array.isArray(items)) throw new TypeError("flatten requires an array");
  if (!Number.isInteger(depth) || depth < 0) {
    throw new TypeError("flatten depth must be a non-negative integer");
  }
  return items.flat(depth);
}
