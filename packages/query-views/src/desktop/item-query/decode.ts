import type { QueryOutputFormat } from "#worker/item-query/contract.ts";
import { Effect, Schema, SchemaIssue } from "effect";
import { isAbsolute } from "node:path";
import type { CliData } from "obsidian";

import { nameDictionary, UNLIMITED_LIMIT } from "@zotlit/item-query";
import {
  cliDefault,
  cliIndexedKey,
  cliJson,
  cliLiterals,
  cliMap,
  cliMapEffect,
  cliParams,
  cliRule,
  cliText,
  cliVariants,
  decodeCliParams,
  amendRejection,
} from "@zotlit/obsidian-kit/cli-params.ts";
import type {
  CliParamName,
  CliRejection,
} from "@zotlit/obsidian-kit/cli-params.ts";
import {
  compareSelectors,
  selectorKey,
  selectorKeySchema,
} from "@zotlit/zotero-reads/contract/library-scope.ts";
import type {
  LibraryScope,
  LibrarySelector,
} from "@zotlit/zotero-reads/contract/library-scope.ts";
import { QUERY_DATASETS } from "@zotlit/zotero-reads/contract/query-codec.ts";
import type {
  DecodedQuery,
  DecodedValues,
  NamedLibraries,
} from "@zotlit/zotero-reads/contract/query-codec.ts";

import type { GuideTopic } from "./guide.ts";
import { GUIDE_TOPIC_NAMES } from "./guide.ts";

import {
  DEFAULT_CLI_LIMIT,
  QUERY_CANCEL_COMMAND,
  QUERY_COMMAND,
  QUERY_GUIDE_COMMAND,
  QUERY_SCHEMA_COMMAND,
  QUERY_VALUES_COMMAND,
  QUERY_ID_FORM,
  QUERY_ID_MAX_LENGTH,
  QUERY_OUTPUT_FORMATS,
} from "#worker/item-query/contract.ts";

export { rejectionDiagnostic } from "#worker/item-query/contract.ts";

const QUERY_ID = /^[\w.-]+$/;
const POSITIVE_INTEGER = /^[1-9]\d*$/;

const queryId = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      (text.length <= QUERY_ID_MAX_LENGTH && QUERY_ID.test(text)) ||
      `id '${text}' is not a query id: use ${QUERY_ID_FORM}.`,
  ),
);

function textOf<T>(
  pick: (text: string) => Schema.Decoder<T>,
  options?: { readonly onExcessProperty?: "error" },
) {
  return Schema.String.pipe(
    cliMapEffect((text: string, parseOptions) =>
      Schema.decodeEffect(pick(text))(text, {
        ...parseOptions,
        ...options,
      }).pipe(Effect.mapError(({ issue }) => issue)),
    ),
  );
}

function splitList(text: string): { value: string; start: number }[] {
  const parts: { value: string; start: number }[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "[") depth++;
    else if (char === "]") depth--;
    else if (char === "," && depth === 0) {
      parts.push({ value: text.slice(start, index).trim(), start });
      start = index + 1;
    }
  }
  parts.push({ value: text.slice(start).trim(), start });
  return parts;
}

const commaList = Schema.String.pipe(
  cliMapEffect((text: string, options) => {
    const parts = splitList(text);
    const empty = parts.findIndex(({ value }) => value === "");
    return empty === -1
      ? Effect.succeed(parts.map(({ value }) => value))
      : Effect.fail(
          new SchemaIssue.Pointer(
            [empty],
            new SchemaIssue.InvalidValue(
              {
                message: `List element ${empty + 1} is empty at position ${parts[empty]!.start + 1}. Give a value between commas.`,
              },
              "",
              options,
            ),
          ),
        );
  }),
);

function listParameter<T>(
  parameter: string,
  expected: string,
  schema: Schema.Decoder<T>,
) {
  return textOf((text) =>
    text.trimStart().startsWith("[")
      ? cliJson(`${parameter} is not valid JSON: use ${expected}.`, schema)
      : commaList.pipe(Schema.decodeTo(schema)),
  );
}

const library = textOf((text): Schema.Decoder<LibraryScope> =>
  text === "all"
    ? Schema.Literal("all").pipe(cliMap((): LibraryScope => ({ mode: "all" })))
    : listParameter(
        "library",
        "a JSON array of Library selectors",
        Schema.Array(
          selectorKeySchema(
            (text) =>
              `'${text}' is not a Library: use personal or group:<groupID>.`,
          ),
        )
          .check(
            Schema.isMinLength(1, {
              message: "Invalid length: Expected >=1 but received 0",
            }),
            Schema.makeFilter(
              (selectors: readonly LibrarySelector[]) =>
                firstRepeat(selectors) === undefined ||
                `library names '${firstRepeat(selectors)}' twice: name each Library once.`,
            ),
          )
          .pipe(
            cliMap((selectors): LibraryScope => ({
              mode: "selected",
              libraries: selectors.toSorted(compareSelectors),
            })),
          ),
      ),
);

const from = cliLiterals(
  QUERY_DATASETS,
  (input) =>
    `from '${input}' is not a Query Dataset: use items, attachments, annotations.`,
);

function firstRepeat(
  selectors: readonly LibrarySelector[],
): string | undefined {
  const seen = new Set<string>();
  for (const selector of selectors) {
    const key = selectorKey(selector);
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return undefined;
}

const limit = textOf((text): Schema.Decoder<number | null> =>
  text === UNLIMITED_LIMIT
    ? Schema.Literal(UNLIMITED_LIMIT).pipe(cliMap(() => null))
    : Schema.String.check(
        Schema.makeFilter(
          (text: string) =>
            (POSITIVE_INTEGER.test(text) &&
              Number.isSafeInteger(Number(text))) ||
            `limit '${text}' is not a positive integer: use a positive integer, or all for every match.`,
        ),
      ).pipe(cliMap(Number)),
);

const contextKey = (parameter: string, noun: string) =>
  Schema.String.check(
    cliIndexedKey(
      `${parameter} must be the Indexed Key of an ${noun}, such as ABCD2345 or ABCD2345g4815.`,
    ),
  );

const FORMULAS_EXAMPLE = 'such as {"year":"date.year"}';

const formulas = cliJson(
  `formulas is not valid JSON: use a JSON object of Formula names and Filter Expressions, ${FORMULAS_EXAMPLE}.`,
  Schema.Unknown,
)
  .check(
    Schema.makeFilter(
      (input: unknown) =>
        !Array.isArray(input) ||
        `formulas is a JSON array: use a JSON object, ${FORMULAS_EXAMPLE}.`,
    ),
    Schema.makeFilter(
      (input: unknown) =>
        (typeof input === "object" && input !== null) ||
        `formulas is not a JSON object: use a JSON object, ${FORMULAS_EXAMPLE}.`,
    ),
    Schema.makeFilter(
      (input: unknown) =>
        Object.values(input as object).every(
          (text) => typeof text === "string",
        ) ||
        `formulas holds an expression that is not text: give each Formula a Filter Expression string, ${FORMULAS_EXAMPLE}.`,
    ),
  )
  .pipe(
    cliMap((input) =>
      nameDictionary(Object.entries(input as Record<string, string>)),
    ),
  );

const SORT_EXPECTED =
  'a JSON array of {"field","direction"} objects with direction "asc" or "desc"';

const sortSpecs = Schema.Array(
  Schema.Struct({
    field: cliText("Give a Sortable Field after the sort sign."),
    direction: cliLiterals(["asc", "desc"]),
  }),
);

const sort = textOf(
  (text): Schema.Decoder<Schema.Schema.Type<typeof sortSpecs>> =>
    text.trimStart().startsWith("[")
      ? cliJson(`sort is not valid JSON: use ${SORT_EXPECTED}.`, sortSpecs)
      : commaList.pipe(
          cliMap((parts) =>
            parts.map((part) => ({
              field:
                part.startsWith("-") || part.startsWith("+")
                  ? part.slice(1)
                  : part,
              direction: part.startsWith("-")
                ? ("desc" as const)
                : ("asc" as const),
            })),
          ),
          Schema.decodeTo(sortSpecs),
        ),
  { onExcessProperty: "error" },
);

const queryOptions = {
  from: cliDefault(from, "items"),
  group: Schema.optionalKey(
    cliText("group is empty: give one scalar Projection Path."),
  ),
  filter: Schema.optionalKey(
    cliText(
      "filter is empty: give a Filter Expression, or omit filter to match every row in the dataset.",
    ),
  ),
  fields: Schema.optionalKey(
    listParameter(
      "fields",
      "a JSON array of Projection Path strings",
      Schema.Array(Schema.String),
    ),
  ),
  formulas: Schema.optionalKey(formulas),
  sort: Schema.optionalKey(sort),
  limit: cliDefault(limit, String(DEFAULT_CLI_LIMIT)),
  output: Schema.optionalKey(
    Schema.String.check(
      Schema.makeFilter(
        (output: string) =>
          (isAbsolute(output) && !output.includes("\0")) ||
          "output must be an absolute path to a new file.",
      ),
    ),
  ),
  format: cliDefault(
    cliLiterals(
      QUERY_OUTPUT_FORMATS,
      (input) =>
        `format '${input}' is not an output format: use ${QUERY_OUTPUT_FORMATS.join(", ")}.`,
    ),
    "json",
  ),
  id: Schema.optionalKey(queryId),
  "this-item": Schema.optionalKey(contextKey("this-item", "Item")),
  "this-attachment": Schema.optionalKey(
    contextKey("this-attachment", "Attachment"),
  ),
};

type QueryOptions = Schema.Struct.Type<typeof queryOptions>;

function decodedQuery(
  options: QueryOptions,
  libraries: NamedLibraries | null,
): DecodedQuery {
  const {
    from,
    filter,
    fields,
    formulas,
    sort,
    limit,
    output,
    format,
    id,
    group,
  } = options;
  const item = options["this-item"];
  const attachment = options["this-attachment"];
  return {
    from,
    libraries,
    limit,
    ...(group === undefined ? {} : { group }),
    ...(filter === undefined ? {} : { filter }),
    ...(fields === undefined ? {} : { fields }),
    ...(formulas === undefined ? {} : { formulas }),
    ...(sort === undefined ? {} : { sort }),
    ...(output === undefined ? {} : { export: { path: output, format } }),
    ...(id === undefined ? {} : { id }),
    ...(item === undefined && attachment === undefined
      ? {}
      : {
          context: {
            ...(item === undefined ? {} : { item }),
            ...(attachment === undefined ? {} : { attachment }),
          },
        }),
  };
}

const formatHasOutput = cliRule(
  "format",
  (input: { format: QueryOutputFormat; output?: string }) =>
    input.format === "json" || input.output !== undefined,
  (input) =>
    `format=${input.format} writes a file: add output=<absolute-path> with a new filename.`,
);

const queryVariants = {
  library: cliParams({ library, ...queryOptions })
    .check(formatHasOutput)
    .pipe(
      cliMap(({ library: scope, ...options }) =>
        decodedQuery(options, { scope, parameter: "library" }),
      ),
    ),
  scope: cliParams(queryOptions)
    .check(formatHasOutput)
    .pipe(cliMap((options) => decodedQuery(options, null))),
};
const queryVariant = (params: CliData) =>
  params.library !== undefined ? "library" : "scope";

export function decodeSchemaArguments(params: CliData) {
  return decodeCliParams(
    params,
    cliParams({ from: Schema.optionalKey(from) }),
    {
      command: QUERY_SCHEMA_COMMAND,
    },
  );
}

const guideParams = cliParams({
  topic: Schema.optionalKey(
    cliLiterals(
      GUIDE_TOPIC_NAMES,
      (input) =>
        `topic '${input}' is not a guide topic: use ${GUIDE_TOPIC_NAMES.join(", ")}.`,
    ),
  ),
}).pipe(cliMap(({ topic }): GuideTopic | null => topic ?? null));

export function decodeGuideArguments(
  params: CliData,
): Effect.Effect<GuideTopic | null, CliRejection> {
  return decodeCliParams(params, guideParams, {
    command: QUERY_GUIDE_COMMAND,
  });
}

const cancelParams = cliParams(
  { id: queryId },
  { id: "id is missing: give the id of the query to cancel, as in id=<id>." },
).pipe(cliMap(({ id }) => id));

export function decodeCancelArguments(
  params: CliData,
): Effect.Effect<string, CliRejection> {
  return decodeCliParams(params, cancelParams, {
    command: QUERY_CANCEL_COMMAND,
  });
}

const queryParams = cliVariants(queryVariant, queryVariants);

export type QueryParam = CliParamName<typeof queryParams>;

export function decodeQuery(
  params: CliData,
): Effect.Effect<DecodedQuery, CliRejection> {
  return decodeCliParams(params, queryParams, {
    command: QUERY_COMMAND,
  }).pipe(Effect.mapError((rejection) => recovery(params, rejection)));
}

function recovery(params: CliData, rejection: CliRejection): CliRejection {
  const { parameter, issue } = rejection;
  if (parameter === "item" || parameter === "attachment") {
    const field =
      params.from === "annotations" ||
      (params.from === "attachments" && parameter === "item")
        ? `${parameter}.indexedKey`
        : "indexedKey";
    return amendRejection(rejection, {
      hint: `Use filter='${field} == "<key>"' to select by Indexed Key.`,
    });
  }
  if (parameter === "libraries") {
    return amendRejection(rejection, {
      hint: "Use library=<list|all> to select the Target Libraries.",
    });
  }
  if (issue) {
    const input = params[parameter];
    const index = issue.keys?.[0];
    if (
      ["fields", "sort", "library"].includes(parameter) &&
      input !== undefined &&
      !input.trimStart().startsWith("[") &&
      typeof index === "number"
    ) {
      const part = splitList(input)[index];
      if (part?.value === "") {
        return amendRejection(rejection, {
          issue: { ...issue, span: { from: part.start, to: part.start } },
        });
      }
    }
  }
  return rejection;
}

const valuesParams = cliParams(
  {
    kind: cliLiterals(
      ["collections", "tags"],
      "kind must be collections or tags.",
    ),
    library: Schema.optionalKey(
      library.check(
        Schema.makeFilter(
          (scope: LibraryScope) =>
            scope.mode === "all" ||
            (scope.mode === "selected" && scope.libraries.length === 1) ||
            "Use one Library selector, or all.",
        ),
      ),
    ),
    match: Schema.optionalKey(Schema.String),
    limit: cliDefault(limit, String(DEFAULT_CLI_LIMIT)),
  },
  { kind: "kind is required: use kind=collections or kind=tags." },
).pipe(
  cliMap(({ library: scope, ...options }): DecodedValues => ({
    ...options,
    libraries:
      scope === undefined ? null : { scope, parameter: "library" as const },
  })),
);

export type QueryValuesParam = CliParamName<typeof valuesParams>;

export function decodeValues(
  params: CliData,
): Effect.Effect<DecodedValues, CliRejection> {
  return decodeCliParams(params, valuesParams, {
    command: QUERY_VALUES_COMMAND,
  });
}
