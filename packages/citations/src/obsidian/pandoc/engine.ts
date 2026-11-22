import type {
  Blocks,
  CitationMode as AstCitationMode,
  Inline,
  Inlines,
  Pandoc,
} from "#core/pandoc/ast.ts";
import type {
  PandocConvertResult,
  PandocOptions,
  PandocRuntime,
  VirtualFiles,
} from "#core/pandoc/runtime.ts";
import { Effect } from "effect";
import { getFrontMatterInfo } from "obsidian";

import type { CslItemData } from "@zotlit/db";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";

import { bibliographyHeadingFilter } from "#core/pandoc/bibliography-heading.ts";
import { defaultLocaleOf } from "#core/pandoc/csl-style.ts";
import { createPandocRuntime } from "#core/pandoc/runtime.ts";

interface SupersedableRequest {
  supersedes?: string;
}

export interface BibliographyRequest extends SupersedableRequest {
  items: readonly CslItemData[];
  styleXml?: string;
  locale?: string;
}

export interface BibliographyEntry {
  readonly id: string;
  readonly marker: Inlines | undefined;
  readonly content: Inlines;
}

export type CitationMode = "normal" | "author-in-text" | "suppress-author";

export interface CitedWork {
  readonly id: string;
  readonly mode: CitationMode;
}

export interface RenderedCitation {
  readonly content: Inlines;
  readonly citations: readonly CitedWork[];
}

export interface CitationRequest extends SupersedableRequest {
  citations: readonly string[];
  items: readonly CslItemData[];
  styleXml?: string;
  locale?: string;
}

export type DocumentFormat = "docx" | "html";

export interface PrepareRequest extends SupersedableRequest {
  markdown: string;
  luaFilters?: readonly string[];
  files?: VirtualFiles;
}

export interface PreparedDocument {
  readonly citedIds: readonly string[];
  withCitedIds(canonical: ReadonlyMap<string, string>): PreparedDocument;
}

export interface RenderRequest extends SupersedableRequest {
  document: PreparedDocument;
  format: DocumentFormat;
  bibliography: readonly CslItemData[];
  styleXml?: string;
  locale?: string;
}

export interface CitationEngine extends AsyncDisposable {
  renderBibliography(
    request: BibliographyRequest,
  ): Promise<readonly BibliographyEntry[]>;
  renderCitations(
    request: CitationRequest,
  ): Promise<readonly RenderedCitation[]>;
  prepareDocument(request: PrepareRequest): Promise<PreparedDocument>;
  renderPrepared(request: RenderRequest): Promise<Uint8Array>;
}

export class CitationEngineError extends Error {
  override name = "CitationEngineError";
}

export class CitationRequestSupersededError extends Error {
  override name = "CitationRequestSupersededError";
}

const MARKDOWN_READER =
  "markdown+wikilinks_title_after_pipe-blank_before_blockquote-pandoc_title_block-yaml_metadata_block-simple_tables-multiline_tables";

const STYLE_FILE = "style.csl";
const BIBLIOGRAPHY_FILE = "bibliography.json";
const PROPERTIES_FILE = "document-properties.yaml";

export async function createCitationEngine(
  wasmBinary: Blob | Uint8Array<ArrayBuffer>,
): Promise<CitationEngine> {
  return new PandocCitationEngine(await createPandocRuntime(wasmBinary));
}

interface ConversionRequest extends SupersedableRequest {
  options: PandocOptions;
  stdin: string;
  files: VirtualFiles;
}

class PandocCitationEngine implements CitationEngine {
  #runtime: PandocRuntime | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #claims = new Map<string, object>();

  constructor(runtime: PandocRuntime) {
    this.#runtime = runtime;
  }

  async renderBibliography(
    request: BibliographyRequest,
  ): Promise<readonly BibliographyEntry[]> {
    return extractBibliography(
      parseAst(await this.#formatBibliography(request)),
    );
  }

  async renderCitations(
    request: CitationRequest,
  ): Promise<readonly RenderedCitation[]> {
    if (request.citations.length === 0) return [];
    return extractCitations(
      parseAst(await this.#formatCitations(request)),
      request.citations.length,
    );
  }

  async #formatBibliography({
    items,
    styleXml,
    locale,
    supersedes,
  }: BibliographyRequest): Promise<string> {
    const style = styleInput(styleXml);
    const { stdout } = await this.#convert({
      options: {
        from: "csljson",
        to: "json",
        standalone: false,
        filters: ["citeproc"],
        ...(locale === undefined ? {} : { metadata: { lang: locale } }),
        ...style.options,
      },
      stdin: JSON.stringify(items),
      files: style.files,
      supersedes,
    });
    return stdout;
  }

  async #formatCitations({
    citations,
    items,
    styleXml,
    locale,
    supersedes,
  }: CitationRequest): Promise<string> {
    const style = styleInput(styleXml);
    const { stdout } = await this.#convert({
      options: {
        from: MARKDOWN_READER,
        to: "json",
        standalone: false,
        filters: ["citeproc"],
        bibliography: [BIBLIOGRAPHY_FILE],
        metadata: {
          "suppress-bibliography": true,
          ...(locale === undefined ? {} : { lang: locale }),
        },
        ...style.options,
      },
      stdin: citations.join("\n\n"),
      files: {
        [BIBLIOGRAPHY_FILE]: JSON.stringify(items),
        ...style.files,
      },
      supersedes,
    });
    return stdout;
  }

  async prepareDocument({
    markdown,
    luaFilters = [],
    files = {},
    supersedes,
  }: PrepareRequest): Promise<PreparedDocument> {
    const filterFiles = Object.fromEntries(
      luaFilters.map((source, index) => [`filter-${index}.lua`, source]),
    );
    const properties = getFrontMatterInfo(markdown);
    const metadataFiles: Record<string, string> = properties.exists
      ? { [PROPERTIES_FILE]: properties.frontmatter }
      : {};
    const { stdout } = await this.#convert({
      options: {
        from: MARKDOWN_READER,
        "metadata-files": Object.keys(metadataFiles),
        to: "json",
        standalone: false,
        filters: Object.keys(filterFiles),
      },
      stdin: markdown.slice(properties.contentStart),
      files: { ...files, ...filterFiles, ...metadataFiles },
      supersedes,
    });
    return new PandocPreparedDocument(JSON.parse(stdout) as Pandoc);
  }

  async renderPrepared({
    document,
    format,
    bibliography,
    styleXml,
    locale,
    supersedes,
  }: RenderRequest): Promise<Uint8Array> {
    const outputName = `output.${format}`;
    const style = styleInput(styleXml);
    const localePass = locale === undefined ? [] : [LOCALE_FILTER_FILE];
    const { outputFile } = await this.#convert({
      options: {
        from: "json",
        to: format,
        standalone: true,
        filters: [
          ...localePass,
          HEADING_FILTER_FILE,
          "citeproc",
          ...localePass,
        ],
        bibliography: [BIBLIOGRAPHY_FILE],
        "output-file": outputName,
        ...style.options,
      },
      stdin: documentJson(document),
      files: {
        ...(locale === undefined
          ? {}
          : { [LOCALE_FILTER_FILE]: citationLocaleFilter(locale) }),
        [HEADING_FILTER_FILE]: bibliographyHeadingFilter(
          styleXml === undefined ? undefined : defaultLocaleOf(styleXml),
        ),
        [BIBLIOGRAPHY_FILE]: JSON.stringify(bibliography),
        ...style.files,
      },
      supersedes,
    });
    if (!outputFile) {
      throw new CitationEngineError(`Pandoc wrote no ${format} output`);
    }
    return outputFile;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#runtime = undefined;
    await this.#queue;
  }

  #convert({
    options,
    stdin,
    files,
    supersedes,
  }: ConversionRequest): Promise<PandocConvertResult> {
    const claim = {};
    if (supersedes !== undefined) {
      if (this.#claims.has(supersedes)) {
        Effect.runSyncWith(logServices)(
          Effect.logTrace("Pandoc request superseded").pipe(
            Effect.annotateLogs({ slot: supersedes }),
            withLogCategory("pandoc"),
          ),
        );
      }
      this.#claims.set(supersedes, claim);
    }

    const result = this.#queue.then(() => {
      if (supersedes !== undefined) {
        if (this.#claims.get(supersedes) !== claim) {
          Effect.runSyncWith(logServices)(
            Effect.logTrace("Pandoc request dropped").pipe(
              Effect.annotateLogs({ slot: supersedes }),
              withLogCategory("pandoc"),
            ),
          );
          throw new CitationRequestSupersededError(
            "A newer request superseded this one",
          );
        }
        this.#claims.delete(supersedes);
      }
      const runtime = this.#runtime;
      if (!runtime) throw new CitationEngineError("The engine is disposed");

      const converted = runtime.convert(options, stdin, files);
      if (converted.stderr)
        throw new CitationEngineError(converted.stderr.trim());
      Effect.runSyncWith(logServices)(
        Effect.logDebug("Pandoc conversion finished").pipe(
          Effect.annotateLogs({
            messages: converted.messages,
          }),
          withLogCategory("pandoc"),
        ),
      );
      return converted;
    });
    this.#queue = result.catch(() => undefined);
    return result;
  }
}

class PandocPreparedDocument implements PreparedDocument {
  readonly #ast: Pandoc;
  #citedIds: readonly string[] | undefined;

  constructor(ast: Pandoc) {
    this.#ast = ast;
  }

  get citedIds(): readonly string[] {
    this.#citedIds ??= distinct([
      ...collectCitedIds(this.#ast.blocks, []),
      ...collectCitedIds(this.#ast.meta, []),
    ]);
    return this.#citedIds;
  }

  withCitedIds(canonical: ReadonlyMap<string, string>): PreparedDocument {
    return new PandocPreparedDocument(
      rewriteCitedIds(this.#ast, canonical) as Pandoc,
    );
  }

  toJson(): string {
    return JSON.stringify(this.#ast);
  }
}

function documentJson(document: PreparedDocument): string {
  if (!(document instanceof PandocPreparedDocument)) {
    throw new CitationEngineError("The document was prepared by no engine");
  }
  return document.toJson();
}

const NOCITE_WILDCARD = "*";

function collectCitedIds(value: unknown, into: string[]): string[] {
  if (Array.isArray(value)) {
    for (const item of value as unknown[]) collectCitedIds(item, into);
    return into;
  }
  if (typeof value !== "object" || value === null) return into;
  for (const [key, nested] of Object.entries(value)) {
    if (key !== "citationId" || typeof nested !== "string") {
      collectCitedIds(nested, into);
    } else if (nested !== NOCITE_WILDCARD) {
      into.push(nested);
    }
  }
  return into;
}

function rewriteCitedIds(
  value: unknown,
  canonical: ReadonlyMap<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => rewriteCitedIds(item, canonical));
  }
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      key === "citationId" && typeof nested === "string"
        ? (canonical.get(nested) ?? nested)
        : rewriteCitedIds(nested, canonical),
    ]),
  );
}

function distinct(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

const LOCALE_FILTER_FILE = "citation-locale.lua";
const HEADING_FILTER_FILE = "bibliography-heading.lua";

function citationLocaleFilter(locale: string): string {
  const marker = `zotlit-citation-locale-${crypto.randomUUID()}`;
  return `local MARKER = ${JSON.stringify(marker)}

function Meta(meta)
  if meta[MARKER] then
    meta.lang = nil
    meta[MARKER] = nil
  elseif not meta.lang then
    meta.lang = pandoc.MetaString(${JSON.stringify(locale)})
    meta[MARKER] = true
  end
  return meta
end
`;
}

function styleInput(styleXml: string | undefined): {
  options: PandocOptions;
  files: VirtualFiles;
} {
  return styleXml === undefined
    ? { options: {}, files: {} }
    : { options: { csl: STYLE_FILE }, files: { [STYLE_FILE]: styleXml } };
}

const ENTRY_ID_PREFIX = "ref-";

const LEFT_MARGIN_CLASS = "csl-left-margin";

function parseAst(stdout: string): Blocks {
  return (JSON.parse(stdout) as Pandoc).blocks;
}

const CITATION_MODES = {
  NormalCitation: "normal",
  AuthorInText: "author-in-text",
  SuppressAuthor: "suppress-author",
} as const satisfies Record<AstCitationMode["t"], CitationMode>;

function extractCitations(
  blocks: Blocks,
  expected: number,
): RenderedCitation[] {
  const paragraphs = blocks.flatMap((block) =>
    block.t === "Para" || block.t === "Plain" ? [block.c] : [],
  );
  if (paragraphs.length !== expected) {
    throw new CitationEngineError(
      `Pandoc formatted ${paragraphs.length} of ${expected} citations`,
    );
  }
  return paragraphs.map((content) => ({
    content,
    citations: collectCitations(content, []),
  }));
}

function collectCitations(inlines: Inlines, into: CitedWork[]): CitedWork[] {
  for (const inline of inlines) {
    if (inline.t === "Cite") {
      for (const { citationId, citationMode } of inline.c[0]) {
        into.push({ id: citationId, mode: CITATION_MODES[citationMode.t] });
      }
    }
    collectCitations(nestedInlines(inline), into);
  }
  return into;
}

function nestedInlines(inline: Inline): Inlines {
  switch (inline.t) {
    case "Emph":
    case "Underline":
    case "Strong":
    case "Strikeout":
    case "Superscript":
    case "Subscript":
    case "SmallCaps":
      return inline.c;
    case "Quoted":
    case "Cite":
    case "Link":
    case "Image":
    case "Span":
      return inline.c[1];
    case "Note":
      return blockInlines(inline.c);
    default:
      return [];
  }
}

function extractBibliography(blocks: Blocks): BibliographyEntry[] {
  return blocks.flatMap((block) => {
    if (block.t !== "Div") return [];
    const [[id], nested] = block.c;
    if (!id.startsWith(ENTRY_ID_PREFIX)) return extractBibliography(nested);
    return {
      id: id.slice(ENTRY_ID_PREFIX.length),
      ...splitEntry(blockInlines(nested)),
    };
  });
}

function splitEntry(
  inlines: Inlines,
): Pick<BibliographyEntry, "marker" | "content"> {
  const [first, ...rest] = inlines;
  if (first?.t !== "Span" || !first.c[0][1].includes(LEFT_MARGIN_CLASS)) {
    return { marker: undefined, content: inlines };
  }
  const marker = dropTrailingSpace(first.c[1]);
  return { marker: marker.length > 0 ? marker : undefined, content: rest };
}

function dropTrailingSpace(inlines: Inlines): Inlines {
  return inlines.at(-1)?.t === "Space" ? inlines.slice(0, -1) : inlines;
}

function blockInlines(blocks: Blocks): Inlines {
  return blocks.flatMap((block) => {
    if (block.t === "Para" || block.t === "Plain") return block.c;
    Effect.runSyncWith(logServices)(
      Effect.logDebug("Dropped a block the engine cannot unwrap").pipe(
        Effect.annotateLogs({
          block: block.t,
        }),
        withLogCategory("pandoc"),
      ),
    );
    return [];
  });
}
