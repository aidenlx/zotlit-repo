import { evalToken, Tag } from "liquidjs";
import type {
  Context,
  Emitter,
  FS,
  Liquid,
  TagToken,
  Template,
  TopLevelToken,
  ValueToken,
} from "liquidjs";

import { withCitationInputProvenance } from "./citation-input.ts";
export { CitationInputError } from "./citation-input.ts";

import type {
  AutoTrim,
  FrontmatterField,
  FrontmatterLanguage,
  TemplateLanguage,
} from "./constants.ts";
import { mergeManagedFrontmatterEntries } from "./frontmatter-merge.ts";
import {
  compileFrontmatterFields as compileFrontmatterFieldsImpl,
  compileManagedFrontmatterEntries as compileManagedFrontmatterEntriesImpl,
  evalManagedFrontmatterEntries,
  validateFrontmatterExpr as validateFrontmatterExprImpl,
} from "./frontmatter.ts";
import type {
  CompiledFrontmatter,
  CompiledManagedFrontmatter,
} from "./frontmatter.ts";
import { TemplateEngine } from "./index.ts";
import { inlineCitation } from "./inline-citation.ts";
import {
  DEFAULT_CITATION_BRANCHES,
  foldLegacyCitationTemplates,
} from "./legacy-citation.ts";
import type { LegacyCitationSources } from "./legacy-citation.ts";
import { createLiquidEngine } from "./liquid.ts";
import {
  LegacyTemplateConversionError,
  LiteratureNoteTemplateError,
  parseLiteratureNoteTemplate as parseLiteratureNoteTemplateImpl,
  synthesizeLegacyLiteratureNoteTemplate,
} from "./literature-note-template.ts";
import type {
  LegacyLiteratureNoteTemplates,
  LiteratureNoteTemplateDocument,
  ManagedFrontmatterEntry,
} from "./literature-note-template.ts";
import { formatManagedRegion } from "./obsidian.ts";

export { updateLiteratureNoteTemplateMatch } from "./literature-note-template-match.ts";

export type { TemplateLanguage } from "./constants.ts";

export {
  DEFAULT_ANNOTATION_ETA,
  DEFAULT_ANNOTATION_LIQUID,
} from "./default-annotation.ts";
export {
  CONVERTED_DEFAULT_PROFILE_DOCUMENT,
  convertLegacyFrontmatterFields,
  LegacyTemplateConversionError,
  literatureNoteTemplateManifestRange,
  LiteratureNoteTemplateError,
  parseLiteratureNoteTemplate,
  synthesizeLegacyLiteratureNoteTemplate,
} from "./literature-note-template.ts";
export type {
  AnnotationSection,
  LegacyLiteratureNoteTemplates,
  LegacyTemplateConversionErrorCode,
  LiteratureNoteTemplateDocument,
  LiteratureNoteTemplateErrorCode,
  LiteratureNoteTemplateManifest,
  MatchTree,
  ManagedBlock,
  ManagedFrontmatterEntry,
  SynthesizedLiteratureNoteTemplateManifest,
} from "./literature-note-template.ts";

export {
  DEFAULT_CITATION_BRANCHES,
  foldLegacyCitationTemplates,
} from "./legacy-citation.ts";
export type { LegacyCitationSources } from "./legacy-citation.ts";

export {
  formatPlainTemplateDocument,
  parsePlainTemplateDocument,
  PlainTemplateDocumentError,
} from "./plain-template-document.ts";
export type {
  PlainTemplateDocument,
  PlainTemplateDocumentErrorCode,
  PlainTemplateDocumentManifest,
} from "./plain-template-document.ts";

export interface ConvertedLegacyLiteratureNoteTemplate {
  readonly source: string;
  readonly document: LiteratureNoteTemplateDocument;
  readonly rendered: {
    readonly create: string;
    readonly update: string | null;
    readonly filename: string;
    readonly annotation: string | null;
  };
  readonly frontmatterPatch: Readonly<Record<string, unknown>>;
  readonly frontmatterFailures: readonly string[];
}

export interface ConvertedLegacyCitationTemplate {
  readonly source: string;
  readonly rendered: { readonly main: string; readonly alt: string };
}

export interface ConvertLegacyCitationTemplateOptions {
  readonly removedNames?: readonly string[];
}

export interface ConvertLegacyLiteratureNoteTemplateOptions {
  readonly frontmatter?: readonly FrontmatterField[];
  readonly javascript?: boolean;
  readonly operationTimestamp?: Temporal.Instant;
  readonly managed?: boolean;
}

export interface RootVariableUse {
  name: string;
  path: string;
  row: number;
  col: number;
}

export interface TemplateSourceOverride {
  source: string;
  language: TemplateLanguage;
}

export interface TemplateFacadeOptions {
  autoTrim?: readonly [AutoTrim, AutoTrim];
  transformRender?: (name: string, output: string) => string;
}

export class TemplateError extends Error {
  readonly _tag = "TemplateError";
  readonly templateName: string;

  constructor(message: string, templateName: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TemplateError";
    this.templateName = templateName;
  }
}

export class MissingTemplateError extends TemplateError {
  constructor(templateName: string, options?: ErrorOptions) {
    super(`Template "${templateName}" not found`, templateName, options);
    this.name = "MissingTemplateError";
  }
}

interface TemplateSlot {
  liquid?: Template[];
  eta?: true;
}

const BRIDGE_TAG_NAME = "ztinclude";

function bridgeSource(name: string): string {
  return `{% ${BRIDGE_TAG_NAME} "${name}" %}`;
}

export class TemplateFacade {
  readonly #registry = new Map<string, TemplateSlot>();
  #hiddenNames: ReadonlySet<string> | undefined;
  readonly #transform: (name: string, output: string) => string;
  readonly #eta: TemplateEngine;
  readonly #liquid: Liquid;
  readonly #etaBaseRender: OmitThisParameter<TemplateEngine["render"]>;
  #annotationSource: TemplateSourceOverride | undefined;

  constructor({ autoTrim, transformRender }: TemplateFacadeOptions = {}) {
    this.#transform = transformRender ?? ((_name, output) => output);
    this.#eta = new TemplateEngine({ autoTrim, debug: true });
    this.#liquid = createLiquidEngine({ fs: this.#makeFs() });

    this.#etaBaseRender = this.#eta.render.bind(this.#eta);

    this.#eta.render = (template, data, meta) =>
      typeof template === "string"
        ? this.#renderByName(template, data)
        : this.#etaBaseRender(template, data, meta);

    this.#liquid.registerTag(BRIDGE_TAG_NAME, this.#createBridgeTag());
  }

  define(name: string, source: string, language: TemplateLanguage): void {
    if (language === "eta") {
      try {
        this.#eta.define(name, source);
      } catch (error) {
        throw new TemplateError(`${name}: ${(error as Error).message}`, name, {
          cause: error,
        });
      }
      this.#registry.set(name, { ...this.#registry.get(name), eta: true });
    } else {
      const parsed = this.#liquid.parse(source, name);
      const tpls =
        name === "citation"
          ? withCitationInputProvenance(parsed, this.#liquid)
          : parsed;
      this.#registry.set(name, { ...this.#registry.get(name), liquid: tpls });
    }
  }

  remove(name: string, language: TemplateLanguage): void {
    const slot = this.#registry.get(name);
    if (!slot) return;

    if (language === "eta") {
      this.#eta.remove(name);
      const { eta: _eta, ...rest } = slot;
      this.#setOrDelete(name, rest);
    } else {
      const { liquid: _liquid, ...rest } = slot;
      this.#setOrDelete(name, rest);
    }
  }

  reset(): void {
    this.#registry.clear();
    this.#eta.reset();
  }

  render<T extends object>(
    name: string,
    data: T,
    sourceOverride?: TemplateSourceOverride,
  ): string {
    const previous = this.#annotationSource;
    this.#annotationSource = undefined;
    try {
      return sourceOverride
        ? this.#renderSource(name, data, sourceOverride)
        : this.#renderByName(name, data);
    } finally {
      this.#annotationSource = previous;
    }
  }

  parseLiteratureNoteTemplate(source: string): LiteratureNoteTemplateDocument {
    return parseLiteratureNoteTemplateImpl(source);
  }

  convertLegacyCitationTemplates(
    legacy: LegacyCitationSources,
    data: { readonly main: object; readonly alt: object },
    options: ConvertLegacyCitationTemplateOptions = {},
  ): ConvertedLegacyCitationTemplate {
    const { language } = legacy;
    const source = foldLegacyCitationTemplates(legacy);
    const branches = DEFAULT_CITATION_BRANCHES[language];
    const render = (variant: "main" | "alt", from: string, name: string) =>
      inlineCitation(
        this.render(name, data[variant], { source: from, language }),
      );

    const rendered = this.#withRegistryWithout(options.removedNames ?? [], () =>
      refuseUnrenderable(() => ({
        main: render("main", source, "citation"),
        alt: render("alt", source, "citation"),
      })),
    );
    assertSameRender(
      "main citation output",
      refuseUnrenderable(() =>
        render("main", legacy.main ?? branches.main, "cite"),
      ),
      rendered.main,
    );
    assertSameRender(
      "alternate citation output",
      refuseUnrenderable(() =>
        render("alt", legacy.alt ?? branches.alt, "cite2"),
      ),
      rendered.alt,
    );
    return { source, rendered };
  }

  convertLegacyLiteratureNoteTemplates(
    legacy: LegacyLiteratureNoteTemplates,
    data: {
      readonly note: object;
      readonly filename: object;
      readonly annotation?: object;
    },
    options: ConvertLegacyLiteratureNoteTemplateOptions = {},
  ): ConvertedLegacyLiteratureNoteTemplate {
    const managed = options.managed ?? true;
    const source = synthesizeLegacyLiteratureNoteTemplate(legacy, {
      frontmatter: options.frontmatter,
      managed,
    });
    const document = this.parseLiteratureNoteTemplate(source);
    const legacyRendered = {
      create: withOneTrailingLineBreak(this.render("note", data.note)),
      update: this.render("content", data.note),
      filename: this.render("filename", data.filename),
      annotation:
        legacy.annotation && data.annotation
          ? this.render("annotation", data.annotation)
          : null,
    };
    const rendered = {
      create: this.renderLiteratureNoteTemplateForCreate(document, data.note),
      update: this.renderLiteratureNoteTemplateForUpdate(document, data.note),
      filename: this.renderLiteratureNoteTemplateFilename(
        document,
        data.filename,
      ),
      annotation:
        legacy.annotation && data.annotation
          ? this.renderLiteratureNoteTemplateAnnotation(
              document,
              data.annotation,
            )
          : null,
    };
    if (managed && rendered.update === null) {
      throw new LegacyTemplateConversionError(
        "legacy-render-mismatch",
        "Converted document has no Managed Block",
        {
          difference: "update output",
          recovery: "Keep one standard content render and retry conversion.",
        },
      );
    }
    assertSameRender("create output", legacyRendered.create, rendered.create);
    if (rendered.update !== null)
      assertSameRender("update output", legacyRendered.update, rendered.update);
    assertSameRender(
      "filename output",
      legacyRendered.filename,
      rendered.filename,
    );
    const frontmatter = this.compileManagedFrontmatterEntries(
      document.manifest.frontmatter ?? [],
      { javascript: options.javascript ?? false },
    );
    if (frontmatter.inertKeys.length > 0) {
      throw new LegacyTemplateConversionError(
        "legacy-frontmatter-inert",
        `Converted Managed Frontmatter requires JavaScript Templates for: ${frontmatter.inertKeys.join(", ")}`,
        {
          difference: "Managed Frontmatter gate",
          recovery:
            "Enable JavaScript Templates on this device, then retry conversion.",
          fields: frontmatter.inertKeys,
        },
      );
    }
    const evaluation = evalManagedFrontmatterEntries(
      frontmatter.compiled,
      data.note,
      options.operationTimestamp ?? Temporal.Now.instant(),
    );
    const frontmatterPatch = mergeManagedFrontmatterEntries(evaluation.values);
    if (legacy.annotation) {
      if (legacyRendered.annotation === null || rendered.annotation === null) {
        throw new LegacyTemplateConversionError(
          "unsupported-legacy-template",
          "Annotation conversion requires verification data and an Annotation Section",
          {
            difference: "annotation verification data",
            recovery:
              "Make one Zotero annotation available, then retry conversion.",
          },
        );
      }
      assertSameRender(
        "annotation output",
        legacyRendered.annotation,
        rendered.annotation,
      );
    }
    return {
      source,
      document,
      rendered,
      frontmatterPatch,
      frontmatterFailures: evaluation.errors.map(({ key }) => key),
    };
  }

  compileLiteratureNoteTemplate(
    document: LiteratureNoteTemplateDocument,
  ): void {
    const { language } = document.manifest;
    const block = document.managedBlock;
    const sources = [
      block
        ? document.body.slice(0, block.start) + document.body.slice(block.end)
        : document.body,
      ...(block ? [block.source] : []),
      document.annotationSection.source,
      document.manifest.filename,
    ];
    sources.forEach((source, index) => {
      const name = `${document.manifest.id}:compile:${index}`;
      this.define(name, source, language);
      this.remove(name, language);
    });
  }

  renderLiteratureNoteTemplateForCreate<T extends object>(
    document: LiteratureNoteTemplateDocument,
    data: T,
  ): string {
    const block = document.managedBlock;
    if (!block) {
      return withOneTrailingLineBreak(
        this.#renderDocumentSource(document, data, {
          part: "body",
          source: document.body,
        }),
      );
    }

    const outerSourceWithoutPlaceholder =
      document.body.slice(0, block.start) + document.body.slice(block.end);
    const placeholder = managedBlockPlaceholder(outerSourceWithoutPlaceholder);
    const outerSource =
      document.body.slice(0, block.start) +
      placeholder +
      document.body.slice(block.end);
    const outer = this.#renderDocumentSource(document, data, {
      part: "body",
      source: outerSource,
    });
    const firstPlaceholder = outer.indexOf(placeholder);
    if (
      firstPlaceholder === -1 ||
      firstPlaceholder !== outer.lastIndexOf(placeholder)
    ) {
      throw new LiteratureNoteTemplateError(
        "invalid-managed-block",
        "Managed Block must render exactly once in the document body",
        {
          recovery:
            "Place the Managed Block at the top level, outside conditionals and loops.",
        },
      );
    }
    const managed = this.#renderDocumentSource(document, data, {
      part: "managed",
      source: block.source,
    });
    return withOneTrailingLineBreak(
      outer.replace(
        placeholder,
        () => `${formatManagedRegion(managed)}${block.trailingLineBreak}`,
      ),
    );
  }

  renderLiteratureNoteTemplateForUpdate<T extends object>(
    document: LiteratureNoteTemplateDocument,
    data: T,
  ): string | null {
    if (!document.managedBlock) return null;
    const managed = this.#renderDocumentSource(document, data, {
      part: "managed",
      source: document.managedBlock.source,
    });
    return formatManagedRegion(managed);
  }

  renderLiteratureNoteTemplateAnnotation<T extends object>(
    document: LiteratureNoteTemplateDocument,
    data: T,
  ): string {
    return this.#renderDocumentSource(document, data, {
      part: "annotation",
      source: document.annotationSection.source,
    });
  }

  renderLiteratureNoteTemplateFilename<T extends object>(
    document: LiteratureNoteTemplateDocument,
    data: T,
  ): string {
    return this.#renderDocumentSource(document, data, {
      part: "filename",
      source: document.manifest.filename,
    });
  }

  setAutoTrim(autoTrim: readonly [AutoTrim, AutoTrim]): void {
    this.#eta.setAutoTrim(autoTrim);
  }

  compileFrontmatterFields(
    fields: readonly FrontmatterField[],
    options: { javascript: boolean },
  ): CompiledFrontmatter {
    return compileFrontmatterFieldsImpl(fields, {
      ...options,
      liquid: this.#liquid,
    });
  }

  compileManagedFrontmatterEntries(
    entries: readonly ManagedFrontmatterEntry[],
    options: { javascript: boolean },
  ): CompiledManagedFrontmatter {
    return compileManagedFrontmatterEntriesImpl(entries, {
      ...options,
      liquid: this.#liquid,
    });
  }

  validateFrontmatterExpr(
    expr: string,
    language: FrontmatterLanguage,
  ): string | null {
    return validateFrontmatterExprImpl(expr, language, this.#liquid);
  }

  analyzeRootVariables(name: string): RootVariableUse[] | null {
    const slot = this.#registry.get(name);
    if (!slot?.liquid) return null;

    const { globals } = this.#liquid.analyzeSync(slot.liquid, {
      partials: false,
    });
    const uses: RootVariableUse[] = [];
    for (const entries of Object.values(globals)) {
      for (const entry of entries) {
        const segments = entry.segments;
        uses.push({
          name: String(segments[0]),
          path: segments.map((segment) => String(segment)).join("."),
          row: entry.location.row,
          col: entry.location.col,
        });
      }
    }
    return uses;
  }

  #setOrDelete(name: string, slot: TemplateSlot): void {
    if (slot.liquid || slot.eta) this.#registry.set(name, slot);
    else this.#registry.delete(name);
  }

  #slot(name: string): TemplateSlot | undefined {
    if (this.#hiddenNames?.has(name)) return undefined;
    return this.#registry.get(name);
  }

  #withRegistryWithout<T>(names: readonly string[], render: () => T): T {
    const previous = this.#hiddenNames;
    this.#hiddenNames = new Set(names);
    try {
      return render();
    } finally {
      this.#hiddenNames = previous;
    }
  }

  #renderByName(name: string, data: object): string {
    if (name === "annotation" && this.#annotationSource) {
      return this.#renderSource(name, data, this.#annotationSource);
    }
    const slot = this.#slot(name);
    if (!slot) throw new MissingTemplateError(name);

    const out = slot.liquid
      ? (this.#liquid.renderSync(slot.liquid, { zt: data }) as string)
      : this.#etaBaseRender(name, data, { filepath: name });
    return this.#transform(name, out);
  }

  #renderSource(
    name: string,
    data: object,
    { source, language }: TemplateSourceOverride,
  ): string {
    if (language === "liquid") {
      const parsed = this.#liquid.parse(source, name);
      const templates =
        name === "citation"
          ? withCitationInputProvenance(parsed, this.#liquid)
          : parsed;
      const out = this.#liquid.renderSync(templates, { zt: data }) as string;
      return this.#transform(name, out);
    }

    let template;
    try {
      template = this.#eta.compile(source);
    } catch (error) {
      throw new TemplateError(`${name}: ${(error as Error).message}`, name, {
        cause: error,
      });
    }
    const out = this.#etaBaseRender(template, data, { filepath: name });
    return this.#transform(name, out);
  }

  #renderDocumentSource(
    document: LiteratureNoteTemplateDocument,
    data: object,
    {
      part,
      source,
    }: {
      part: "body" | "managed" | "annotation" | "filename";
      source: string;
    },
  ): string {
    const previous = this.#annotationSource;
    this.#annotationSource = {
      source: document.annotationSection.source,
      language: document.manifest.language,
    };
    try {
      return this.#renderSource(`${document.manifest.id}:${part}`, data, {
        source,
        language: document.manifest.language,
      });
    } finally {
      this.#annotationSource = previous;
    }
  }

  #makeFs(): FS {
    const readSource = (name: string): string => {
      if (
        !this.#slot(name) &&
        !(name === "annotation" && this.#annotationSource)
      ) {
        throw new MissingTemplateError(name);
      }
      return bridgeSource(name);
    };
    return {
      existsSync: () => true,
      readFileSync: readSource,
      exists: async () => true,
      readFile: async (name) => readSource(name),
      resolve: (_dir, file, ext) => file + ext,
    };
  }

  #createBridgeTag() {
    // oxlint-disable-next-line typescript/no-this-alias
    const self = this;

    return class BridgeTag extends Tag {
      readonly #nameToken: ValueToken;

      constructor(
        tagToken: TagToken,
        remainTokens: TopLevelToken[],
        liquid: Liquid,
      ) {
        super(tagToken, remainTokens, liquid);
        const nameToken = this.tokenizer.readValue();
        if (!nameToken) {
          throw new Error(`${BRIDGE_TAG_NAME}: missing template name`);
        }
        this.#nameToken = nameToken;
      }

      *render(
        ctx: Context,
        emitter: Emitter,
      ): Generator<unknown, void, unknown> {
        const name = (yield evalToken(this.#nameToken, ctx)) as string;
        const binding =
          name === "annotation" ? self.#annotationSource : undefined;
        const slot = self.#slot(name);
        if (!slot && !binding) throw new MissingTemplateError(name);
        const templates = binding
          ? binding.language === "liquid"
            ? self.#liquid.parse(binding.source, name)
            : undefined
          : slot?.liquid;

        if (templates) {
          const out = (yield self.#liquid.renderer.renderTemplates(
            templates,
            ctx,
          )) as string;
          emitter.write(self.#transform(name, out));
        } else {
          const data = ctx.getSync(["zt"]) as object;
          emitter.write(self.#renderByName(name, data));
        }
      }
    };
  }
}

function refuseUnrenderable<T>(render: () => T): T {
  try {
    return render();
  } catch (error) {
    if (error instanceof LegacyTemplateConversionError) throw error;
    throw new LegacyTemplateConversionError(
      "unsupported-legacy-template",
      `The legacy citation templates failed to render: ${(error as Error).message}`,
      {
        difference: "citation render",
        recovery:
          "Keep the legacy files unchanged and adjust the templates before retrying conversion.",
        cause: error,
      },
    );
  }
}

function assertSameRender(
  difference: string,
  legacy: string,
  converted: string,
): void {
  if (legacy === converted) return;
  let byte = 0;
  const limit = Math.min(legacy.length, converted.length);
  while (byte < limit && legacy[byte] === converted[byte]) byte += 1;
  throw new LegacyTemplateConversionError(
    "legacy-render-mismatch",
    `Converted ${difference} differs from the legacy render at byte ${byte}`,
    {
      difference,
      recovery:
        "Keep the legacy files unchanged and adjust the templates before retrying conversion.",
    },
  );
}

let nextManagedBlockPlaceholder = 0;

function withOneTrailingLineBreak(body: string): string {
  const trimmed = body.trimEnd();
  const trailing = body.slice(trimmed.length).includes("\r\n") ? "\r\n" : "\n";
  return `${trimmed}${trailing}`;
}

function managedBlockPlaceholder(source: string): string {
  let placeholder: string;
  do {
    placeholder = `\uE000zotlit-managed-${nextManagedBlockPlaceholder}\uE001`;
    nextManagedBlockPlaceholder += 1;
  } while (source.includes(placeholder));
  return placeholder;
}
