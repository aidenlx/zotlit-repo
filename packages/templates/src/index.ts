import { Eta, EtaError, EtaParseError } from "eta/core";
import type { EtaConfig, TemplateFunction } from "eta/core";

import { basename } from "./basename.ts";
import { formatBlockquote } from "./blockquote.ts";
import { coerceOutput } from "./coerce.ts";
import { DEFAULT_AUTO_TRIM } from "./constants.ts";
import type { AutoTrim } from "./constants.ts";
import { embed } from "./embed.ts";
import { filenameSuffix } from "./filename-suffix.ts";
import { formatTemplatePandocCitation } from "./pandoc-citation-adapter.ts";
import { replaceHelper } from "./replace-helper.ts";
import { formatTemplateTexCitation } from "./tex-citation-adapter.ts";

export interface TemplateEngineOptions {
  autoTrim?: readonly [AutoTrim, AutoTrim];
  debug?: boolean;
  transformRender?: (name: string, output: string) => string;
}

export class TemplateEngine extends Eta {
  readonly #sources = new Map<string, string>();

  readonly bqHelper = formatBlockquote;
  readonly basenameHelper = basename;
  readonly suffixHelper = filenameSuffix;
  readonly embedHelper = embed;
  readonly pandocCiteHelper = formatTemplatePandocCitation;
  readonly texCiteHelper = formatTemplateTexCitation;

  constructor({
    autoTrim = [DEFAULT_AUTO_TRIM.leading, DEFAULT_AUTO_TRIM.trailing],
    debug = false,
    transformRender,
  }: TemplateEngineOptions = {}) {
    super({
      cache: true,
      varName: "zt",
      autoTrim: [...autoTrim],
      debug,
      autoEscape: false,
      autoFilter: true,
      filterFunction: coerceOutput,
      functionHeader:
        "const bq = (fn) => output(this.bqHelper(capture(fn))); const basename = this.basenameHelper; const suffix = this.suffixHelper; const embed = this.embedHelper; const pandocCite = this.pandocCiteHelper; const texCite = this.texCiteHelper;" +
        "const renderAnnotation = (annotation) => { if (annotation == null) throw new TypeError('renderAnnotation requires an annotation'); return include('annotation', annotation); };",
      plugins: [includeDataPlugin],
    });

    const compileBase = this.compile;
    this.compile = (template, options) => {
      this.#assertExpressionSyntax(template);
      return compileBase.call(this, template, options);
    };

    if (transformRender) {
      const renderBase = this.render;
      this.render = (template, data, meta) => {
        const out = renderBase.call(this, template, data, meta);
        return typeof template === "string"
          ? transformRender(template, out)
          : out;
      };

      const renderAsyncBase = this.renderAsync;
      this.renderAsync = (template, data, meta) =>
        renderAsyncBase
          .call(this, template, data, meta)
          .then((out) =>
            typeof template === "string" ? transformRender(template, out) : out,
          );
    }
  }

  define(name: string, source: string): void {
    if (name === "") throw new EtaError("Template name is empty");
    const compiledSync = this.compile(source);
    const compiledAsync = this.compile(source, { async: true });
    this.#sources.set(name, source);
    this.templatesSync.define(name, compiledSync);
    this.templatesAsync.define(name, compiledAsync);
  }

  remove(name: string): void {
    this.#sources.delete(name);
    this.templatesSync.remove(name);
    this.templatesAsync.remove(name);
  }

  reset(): void {
    this.#sources.clear();
    this.templatesSync.reset();
    this.templatesAsync.reset();
  }

  setAutoTrim(autoTrim: readonly [AutoTrim, AutoTrim]): void {
    this.config.autoTrim = [...autoTrim] as [AutoTrim, AutoTrim];
    this.templatesSync.reset();
    this.templatesAsync.reset();
    for (const [name, source] of this.#sources) {
      this.templatesSync.define(name, this.compile(source));
      this.templatesAsync.define(name, this.compile(source, { async: true }));
    }
  }

  #assertExpressionSyntax(template: string): void {
    let searchFrom = 0;
    for (const node of this.parse(template)) {
      if (typeof node !== "object" || (node.t !== "i" && node.t !== "r")) {
        continue;
      }

      const index = template.indexOf(node.val, searchFrom);
      if (index !== -1) searchFrom = index + node.val.length;

      try {
        // oxlint-disable-next-line no-implied-eval
        new Function(`return (${node.val}\n);`);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw new EtaParseError(
          pointToSyntaxError(
            template,
            index === -1 ? searchFrom : index,
            `Bad expression — ${error.message}`,
          ),
        );
      }
    }
  }
}

export { basename } from "./basename.ts";
export { formatBlockquote } from "./blockquote.ts";
export { embed } from "./embed.ts";
export {
  filenameSuffix,
  hasSuffixMarker,
  replaceSuffixMarkers,
} from "./filename-suffix.ts";
export { inlineCitation } from "./inline-citation.ts";
export {
  joinNotePath,
  MAX_SEGMENT_BYTES,
  normalizeFilename,
  resolveFlatNoteName,
  resolveNoteRelPath,
  truncateToByteLimit,
} from "./note-path.ts";

function pointToSyntaxError(
  source: string,
  index: number,
  message: string,
): string {
  const before = source.slice(0, index).split("\n");
  const line = before.length;
  const col = before[before.length - 1]!.length + 1;
  const sourceLine = source.split("\n")[line - 1] ?? "";
  return `${message} at line ${line} col ${col}:\n\n  ${sourceLine}\n  ${" ".repeat(col - 1)}^`;
}

const includeDataPlugin: EtaConfig["plugins"][number] = {
  processFnString(fnString, config) {
    const varName = config?.varName ?? "it";
    const synced = replaceHelper(
      fnString,
      `let include = (__eta_t, __eta_d) => this.render(__eta_t, {...${varName}, ...(__eta_d ?? {})}, options);`,
      `let include = (__eta_t, __eta_d) => this.render(__eta_t, __eta_d ?? ${varName}, options);`,
    );
    return replaceHelper(
      synced,
      `let includeAsync = (__eta_t, __eta_d) => this.renderAsync(__eta_t, {...${varName}, ...(__eta_d ?? {})}, options);`,
      `let includeAsync = (__eta_t, __eta_d) => this.renderAsync(__eta_t, __eta_d ?? ${varName}, options);`,
    );
  },
};

export type { TemplateFunction };
