import type { RenderTemplate } from "#core/cli/vocabulary.ts";
import type { PartialContext } from "#core/render/index.ts";
import type { WorkbenchIdentity } from "#worker/cli/workbench-identity.ts";
import type { Effect } from "effect";
import { Schema } from "effect";
import type { CliData } from "obsidian";

import { DEFAULT_CITATION_VARIANT } from "@zotlit/db";
import type { CitationVariant, ContractRoot, TemplateSlot } from "@zotlit/db";
import { isPartialNameShape } from "@zotlit/notes/core/template/defaults.ts";
import {
  cliDefault,
  cliLiterals,
  cliMap,
  cliNotApplicable,
  cliOneOf,
  cliParams,
  cliSwitch,
  cliText,
  cliValue,
  cliVariants,
  decodeCliParams,
  expectSourceParam,
  noCliParams,
} from "@zotlit/obsidian-kit/cli-params.ts";
import type {
  CliOutput,
  CliParamName,
  CliRejection,
} from "@zotlit/obsidian-kit/cli-params.ts";
import { isIndexedKey } from "@zotlit/zotero-types/keys";

import type { Diagnostic } from "./envelope.ts";
import { diagnostic } from "./envelope.ts";
import type { GuideTopic } from "./guide.ts";
import { GUIDE_TOPIC_NAMES } from "./guide.ts";

import { CONTRACT_ROOT_NAMES } from "#core/cli/schema.ts";
import {
  choices,
  CITATION_EXAMPLE_NAMES,
  CITATION_TEMPLATE,
  CITATION_VARIANT_NAMES,
  FRONTMATTER_LANGUAGE_NAMES,
  FRONTMATTER_MERGE_NAMES,
  isPartialTemplate,
  PARTIAL_CONTEXT_NAMES,
  partialTemplateName,
  quotedList,
  RENDER_TEMPLATE_NAMES,
  TEMPLATE_SLOT_NAMES,
} from "#core/cli/vocabulary.ts";

export {
  CITATION_EXAMPLE_NAMES,
  CITATION_VARIANT_NAMES,
  FRONTMATTER_LANGUAGE_NAMES,
  FRONTMATTER_MERGE_NAMES,
  PARTIAL_CONTEXT_NAMES,
  RENDER_TEMPLATE_NAMES,
  TEMPLATE_SLOT_NAMES,
};

const INDEXED_KEY_MESSAGE = "key must be an Indexed Key.";

const indexedKey = indexedKeyOr(INDEXED_KEY_MESSAGE);

function indexedKeyOr(message: string) {
  return Schema.String.check(
    Schema.makeFilter((key: string) => isIndexedKey(key) || message),
  );
}

function keyMessage(citation: boolean): string {
  return citation
    ? `key must be an Indexed Key, or select a built-in Citation with example=${choices(CITATION_EXAMPLE_NAMES)}.`
    : INDEXED_KEY_MESSAGE;
}

function exampleMessage(citation: boolean): string {
  return citation
    ? `Select the Citation with example=${choices(CITATION_EXAMPLE_NAMES)} or with key=<indexed-key>, not both.`
    : "example selects a built-in Citation set; it applies to the citation root only. Every other root selects a Zotero object with key=<indexed-key>.";
}

const citationByKey = {
  example: cliNotApplicable(exampleMessage(true)),
  key: indexedKeyOr(keyMessage(true)),
};

const citationByExample = {
  example: cliLiterals(
    CITATION_EXAMPLE_NAMES,
    `example must be ${quotedList(CITATION_EXAMPLE_NAMES)}.`,
  ),
};

const NOTE_SELECTOR_MESSAGE =
  "Select one non-empty note path, key, or Citation example.";

const dataRoot = cliLiterals(CONTRACT_ROOT_NAMES, rootVocabulary());

const dataReading = {
  query: Schema.optionalKey(
    cliText("query must contain text. Use query=<field name> for discovery."),
  ),
  path: Schema.optionalKey(
    cliText("path must contain text. Use query=<field name> for discovery."),
  ),
  full: cliSwitch("Use the full flag to request the complete zt object."),
  format: cliDefault(cliLiterals(["json"], "format must be 'json'."), "json"),
  "expect-source": expectSourceParam,
};

const oneReadMode = cliOneOf<{ query?: string; path?: string; full?: true }>(
  ["query", "path", "full"],
  { many: "Use one of query=<words>, path=<zt.path>, or full." },
);

function dataRequest<TSelected extends object>(
  selected: TSelected,
  reading: { root: ContractRoot } & Schema.Struct<typeof dataReading>["Type"],
) {
  const { root, format, query, path, full } = reading;
  return {
    ...selected,
    root,
    format,
    ...(query === undefined ? {} : { query }),
    ...(path === undefined ? {} : { path }),
    ...(full === undefined ? {} : { full }),
  };
}

const dataParams = cliVariants(
  ({ note, root, key, example }) =>
    note !== undefined
      ? "note"
      : root !== "citation"
        ? "item"
        : key !== undefined || example === undefined
          ? "citation"
          : "citationExample",
  {
    note: cliParams(
      {
        root: dataRoot,
        note: cliText(NOTE_SELECTOR_MESSAGE),
        key: cliNotApplicable(NOTE_SELECTOR_MESSAGE),
        example: cliNotApplicable(NOTE_SELECTOR_MESSAGE),
        ...dataReading,
      },
      { root: rootVocabulary() },
    )
      .check(oneReadMode)
      .pipe(cliMap(({ note, ...reading }) => dataRequest({ note }, reading))),
    citation: cliParams(
      { root: dataRoot, ...citationByKey, ...dataReading },
      { key: keyMessage(true) },
    )
      .check(oneReadMode)
      .pipe(cliMap(({ key, ...reading }) => dataRequest({ key }, reading))),
    citationExample: cliParams({
      root: dataRoot,
      ...citationByExample,
      ...dataReading,
    })
      .check(oneReadMode)
      .pipe(
        cliMap(({ example, ...reading }) => dataRequest({ example }, reading)),
      ),
    item: cliParams(
      {
        root: dataRoot,
        example: cliNotApplicable(exampleMessage(false)),
        key: indexedKey,
        ...dataReading,
      },
      { root: rootVocabulary(), key: INDEXED_KEY_MESSAGE },
    )
      .check(oneReadMode)
      .pipe(cliMap(({ key, ...reading }) => dataRequest({ key }, reading))),
  },
);

export type DataRequest = CliOutput<typeof dataParams>;
export type DataParam = CliParamName<typeof dataParams>;

export function parseDataRequest(
  params: CliData,
): Effect.Effect<DataRequest, CliRejection> {
  return decodeCliParams(params, dataParams, {
    command: "template-data",
    misplaced: { template: dataCommandTemplateHint() },
  });
}

const renderTemplateMessage = `template must be ${quotedList(RENDER_TEMPLATE_NAMES)}.`;

const notPartialRoot = cliNotApplicable(
  "template-render infers the data root from template; root names the caller a partial is rendered as, on template=partial:<name> only.",
);
const notCitationVariant = cliNotApplicable(
  `variant names a Citation Variant; it applies to template=${CITATION_TEMPLATE} only.`,
);
const notCitationExample = cliNotApplicable(exampleMessage(false));

const partialTemplate = Schema.String.check(
  Schema.makeFilter(
    (input: string) =>
      (isPartialTemplate(input) &&
        isPartialNameShape(partialTemplateName(input))) ||
      "A Shared Partial name is letters, digits, and hyphens: template=partial:<name>.",
  ),
).pipe(cliMap((input) => input as `partial:${string}`));

const citationVariant = cliDefault(
  cliLiterals(
    CITATION_VARIANT_NAMES,
    `variant must be ${quotedList(CITATION_VARIANT_NAMES)}.`,
  ),
  DEFAULT_CITATION_VARIANT,
);

const renderFormat = {
  format: cliDefault(
    cliLiterals(["markdown", "json"], "format must be 'markdown' or 'json'."),
    "json",
  ),
  "expect-source": expectSourceParam,
};

function renderRequest<TSelected extends object>(
  selected: TSelected,
  reading: {
    template: RenderTemplate;
    format: "markdown" | "json";
    root?: PartialContext;
    variant?: CitationVariant;
  },
) {
  const { template, format, root, variant } = reading;
  return {
    ...selected,
    template,
    ...(root === undefined ? {} : { root }),
    ...(variant === undefined ? {} : { variant }),
    format,
  };
}

const renderParams = cliVariants(
  ({ template, root, key, example }) =>
    template === CITATION_TEMPLATE
      ? key !== undefined || example === undefined
        ? "citation"
        : "citationExample"
      : template === undefined || !isPartialTemplate(template)
        ? "slot"
        : root !== "citation"
          ? "partial"
          : key !== undefined || example === undefined
            ? "partialCitation"
            : "partialCitationExample",
  {
    slot: cliParams(
      {
        template: cliLiterals(TEMPLATE_SLOT_NAMES, renderTemplateMessage),
        root: notPartialRoot,
        example: notCitationExample,
        variant: notCitationVariant,
        key: indexedKey,
        ...renderFormat,
      },
      { template: renderTemplateMessage, key: INDEXED_KEY_MESSAGE },
    ).pipe(
      cliMap(({ key, template, format }) =>
        renderRequest({ key }, { template, format }),
      ),
    ),
    citation: cliParams(
      {
        template: Schema.Literal(CITATION_TEMPLATE),
        root: notPartialRoot,
        ...citationByKey,
        variant: citationVariant,
        ...renderFormat,
      },
      { key: keyMessage(true) },
    ).pipe(
      cliMap(({ key, template, variant, format }) =>
        renderRequest({ key }, { template, variant, format }),
      ),
    ),
    citationExample: cliParams({
      template: Schema.Literal(CITATION_TEMPLATE),
      root: notPartialRoot,
      ...citationByExample,
      variant: citationVariant,
      ...renderFormat,
    }).pipe(
      cliMap(({ example, template, variant, format }) =>
        renderRequest({ example }, { template, variant, format }),
      ),
    ),
    partial: cliParams(
      {
        template: partialTemplate,
        root: cliDefault(
          cliLiterals(
            PARTIAL_CONTEXT_NAMES,
            `root must be ${quotedList(PARTIAL_CONTEXT_NAMES)}.`,
          ),
          "note",
        ),
        example: notCitationExample,
        variant: notCitationVariant,
        key: indexedKey,
        ...renderFormat,
      },
      { key: INDEXED_KEY_MESSAGE },
    ).pipe(
      cliMap(({ key, template, root, format }) =>
        renderRequest({ key }, { template, root, format }),
      ),
    ),
    partialCitation: cliParams(
      {
        template: partialTemplate,
        root: Schema.Literal("citation"),
        ...citationByKey,
        variant: citationVariant,
        ...renderFormat,
      },
      { key: keyMessage(true) },
    ).pipe(
      cliMap(({ key, template, root, variant, format }) =>
        renderRequest({ key }, { template, root, variant, format }),
      ),
    ),
    partialCitationExample: cliParams({
      template: partialTemplate,
      root: Schema.Literal("citation"),
      ...citationByExample,
      variant: citationVariant,
      ...renderFormat,
    }).pipe(
      cliMap(({ example, template, root, variant, format }) =>
        renderRequest({ example }, { template, root, variant, format }),
      ),
    ),
  },
);

export type RenderRequest = CliOutput<typeof renderParams>;
export type RenderParam = CliParamName<typeof renderParams>;

export function parseRenderRequest(
  params: CliData,
): Effect.Effect<RenderRequest, CliRejection> {
  return decodeCliParams(params, renderParams, { command: "template-render" });
}

const notOtherDocument = cliNotApplicable(
  "Provide exactly one of profile, document, or source.",
);

const documentRenderParams = cliVariants(
  ({ profile, document, source }) =>
    profile === undefined && document !== undefined
      ? "document"
      : profile === undefined && source !== undefined
        ? "source"
        : "profile",
  {
    profile: cliParams(
      {
        profile: cliValue("profile"),
        document: notOtherDocument,
        source: notOtherDocument,
        key: indexedKey,
        "expect-source": expectSourceParam,
      },
      {
        key: INDEXED_KEY_MESSAGE,
        profile: "Provide exactly one of profile, document, or source.",
      },
    ).pipe(cliMap(({ key, profile }) => ({ key, profile }))),
    document: cliParams(
      {
        document: cliValue("document"),
        source: notOtherDocument,
        key: indexedKey,
        "expect-source": expectSourceParam,
      },
      { key: INDEXED_KEY_MESSAGE },
    ).pipe(cliMap(({ key, document }) => ({ key, document }))),
    source: cliParams(
      {
        source: cliValue("source"),
        key: indexedKey,
        "expect-source": expectSourceParam,
      },
      { key: INDEXED_KEY_MESSAGE },
    ).pipe(cliMap(({ key, source }) => ({ key, source }))),
  },
);

export type DocumentRenderRequest = CliOutput<typeof documentRenderParams>;
export type DocumentRenderParam = CliParamName<typeof documentRenderParams>;

export function parseDocumentRenderRequest(
  params: CliData,
): Effect.Effect<DocumentRenderRequest, CliRejection> {
  return decodeCliParams(params, documentRenderParams, {
    command: "template-document-render",
  });
}

const noParams = noCliParams.pipe(cliMap(() => null));

export function parseSchemaRequest(
  params: CliData,
): Effect.Effect<null, CliRejection> {
  return decodeCliParams(params, noParams, {
    command: "template-schema",
    misplaced: {
      key: "template-schema does not accept an item selector.",
      root: SCHEMA_LISTS_EVERY_ROOT_MESSAGE,
      template: SCHEMA_LISTS_EVERY_ROOT_MESSAGE,
    },
  });
}

const templateSlotMessage = `template must be ${quotedList(TEMPLATE_SLOT_NAMES)}.`;

const sourceParams = cliParams(
  { template: cliLiterals(TEMPLATE_SLOT_NAMES, templateSlotMessage) },
  { template: templateSlotMessage },
).pipe(cliMap((input) => input.template));

export type SourceParam = CliParamName<typeof sourceParams>;

export function parseSourceRequest(
  params: CliData,
): Effect.Effect<TemplateSlot, CliRejection> {
  return decodeCliParams(params, sourceParams, {
    command: "template-source",
    misplaced: {
      key: "template-source does not accept an item selector.",
      root: slotCommandRootHint(),
    },
  });
}

const guideParams = cliParams({
  topic: Schema.optionalKey(
    cliLiterals(
      GUIDE_TOPIC_NAMES,
      `topic must be ${quotedList(GUIDE_TOPIC_NAMES)}.`,
    ),
  ),
}).pipe(cliMap((input) => input.topic ?? null));

export type GuideParam = CliParamName<typeof guideParams>;

export function parseGuideRequest(
  params: CliData,
): Effect.Effect<GuideTopic | null, CliRejection> {
  return decodeCliParams(params, guideParams, { command: "template-guide" });
}

export function parseStatusRequest(
  params: CliData,
): Effect.Effect<null, CliRejection> {
  return decodeCliParams(params, noParams, { command: "template-status" });
}

export function parseFrontmatterStatusRequest(
  params: CliData,
): Effect.Effect<null, CliRejection> {
  return decodeCliParams(params, noParams, { command: "frontmatter-status" });
}

const language = cliLiterals(
  FRONTMATTER_LANGUAGE_NAMES,
  `language must be ${quotedList(FRONTMATTER_LANGUAGE_NAMES)}.`,
);

const evalTarget = {
  key: indexedKey,
  format: cliDefault(cliLiterals(["json"], "format must be 'json'."), "json"),
  "expect-source": expectSourceParam,
};

const frontmatterEvalParams = cliVariants(
  ({ expr }) => (expr === undefined ? "configured" : "adhoc"),
  {
    configured: cliParams(
      {
        language: cliNotApplicable("language requires expr."),
        ...evalTarget,
      },
      { key: INDEXED_KEY_MESSAGE },
    ).pipe(cliMap(({ key, format }) => ({ key, format, adhoc: null }))),
    adhoc: cliParams(
      {
        ...evalTarget,
        expr: Schema.String,
        language: cliDefault(language, "liquid"),
      },
      { key: INDEXED_KEY_MESSAGE },
    ).pipe(
      cliMap(({ key, format, expr, language }) => ({
        key,
        format,
        adhoc: { expr, language },
      })),
    ),
  },
);

export type FrontmatterEvalRequest = CliOutput<typeof frontmatterEvalParams>;
export type FrontmatterEvalParam = CliParamName<typeof frontmatterEvalParams>;

export function parseFrontmatterEvalRequest(
  params: CliData,
): Effect.Effect<FrontmatterEvalRequest, CliRejection> {
  return decodeCliParams(params, frontmatterEvalParams, {
    command: "frontmatter-eval",
  });
}

const fieldKey = trimmedText("field must not be empty.");

function trimmedText(message: string) {
  return cliText(message).pipe(cliMap((text) => text.trim()));
}

const frontmatterSetParams = cliParams({
  field: fieldKey,
  expr: Schema.optionalKey(trimmedText("expr must not be empty.")),
  language: Schema.optionalKey(language),
  merge: Schema.optionalKey(
    cliLiterals(
      FRONTMATTER_MERGE_NAMES,
      `merge must be ${quotedList(FRONTMATTER_MERGE_NAMES)}.`,
    ),
  ),
}).pipe(
  cliMap(({ field, expr, language, merge }) => ({
    field,
    ...(expr !== undefined ? { expr } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(merge !== undefined ? { merge } : {}),
  })),
);

export type FrontmatterSetRequest = CliOutput<typeof frontmatterSetParams>;

export type FrontmatterSetParam = CliParamName<typeof frontmatterSetParams>;

export function parseFrontmatterSetRequest(
  params: CliData,
): Effect.Effect<FrontmatterSetRequest, CliRejection> {
  return decodeCliParams(params, frontmatterSetParams, {
    command: "frontmatter-set",
  });
}

const frontmatterRemoveParams = cliParams({ field: fieldKey });

export type FrontmatterRemoveRequest = CliOutput<
  typeof frontmatterRemoveParams
>;

export type FrontmatterRemoveParam = CliParamName<
  typeof frontmatterRemoveParams
>;

export function parseFrontmatterRemoveRequest(
  params: CliData,
): Effect.Effect<FrontmatterRemoveRequest, CliRejection> {
  return decodeCliParams(params, frontmatterRemoveParams, {
    command: "frontmatter-remove",
  });
}

const frontmatterReorderParams = cliParams({
  order: Schema.String.pipe(
    cliMap((order) => order.split(",").map((key) => key.trim())),
  ).check(
    Schema.makeFilter(
      (order: readonly string[]) =>
        order.every((key) => key !== "") ||
        "order must be a comma-separated list of field keys, with no empty entries.",
    ),
  ),
});

export type FrontmatterReorderRequest = CliOutput<
  typeof frontmatterReorderParams
>;

export type FrontmatterReorderParam = CliParamName<
  typeof frontmatterReorderParams
>;

export function parseFrontmatterReorderRequest(
  params: CliData,
): Effect.Effect<FrontmatterReorderRequest, CliRejection> {
  return decodeCliParams(params, frontmatterReorderParams, {
    command: "frontmatter-reorder",
  });
}

export function targetMismatch(
  params: CliData,
  identity: WorkbenchIdentity,
): Diagnostic | null {
  const expectedSource = params["expect-source"];
  const actual = identity.source?.id ?? null;
  if (expectedSource !== undefined && expectedSource !== actual) {
    return diagnostic(
      "TARGET_MISMATCH",
      `Expected Zotero source '${expectedSource}', connected to '${actual ?? "unresolved"}'.`,
      {
        target: "source",
        expected: expectedSource,
        actual,
      },
    );
  }
  return null;
}

function rootVocabulary(): string {
  return `root must be ${quotedList(CONTRACT_ROOT_NAMES)}.`;
}

function slotCommandRootHint(): string {
  return (
    `template-source selects a Template slot; use template=${choices(TEMPLATE_SLOT_NAMES)}. ` +
    `root=${choices(CONTRACT_ROOT_NAMES)} selects a data root, on template-data.`
  );
}

function dataCommandTemplateHint(): string {
  return (
    `template-data selects a data root; use root=${choices(CONTRACT_ROOT_NAMES)}. ` +
    `template=${choices(TEMPLATE_SLOT_NAMES)} selects a Template slot, on template-render or template-source.`
  );
}

const SCHEMA_LISTS_EVERY_ROOT_MESSAGE =
  "template-schema takes no parameters; it answers with the schema of every data root, keyed by root under 'schemas'.";
