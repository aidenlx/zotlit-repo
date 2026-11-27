import { Effect } from "effect";

import type {
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";

import type { QueryDataset } from "./dataset.ts";
import { describeQueryCustomFields } from "./describe-query-custom-fields.ts";
import type { ValueShape } from "./fields.ts";
import {
  GLOBAL_FUNCTIONS,
  IF_FUNCTION,
  METHOD_ENTRIES,
  PROPERTY_ENTRIES,
  VALUE_TYPES,
} from "./filter-functions.ts";
import type {
  FunctionDefinition,
  FunctionParameter,
} from "./filter-functions.ts";
import type { FilterValueType } from "./filter-values.ts";
import { parseProjectionPath } from "./projection-path.ts";
import { canGroup } from "./projection.ts";
import { ITEMS } from "./query-items.ts";
import type { SortSpec } from "./request.ts";

export type JsonType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "any";

export type FilterType = Exclude<FilterValueType, "null">;

export interface SchemaCapabilities {
  readonly filter: FilterType | "any" | null;
  readonly projection: boolean;
  readonly sort: boolean;
  readonly group: boolean;
}

export interface SchemaField extends SchemaCapabilities {
  readonly description?: string;
  readonly relation?: "items" | "attachments" | "annotations" | "notes";
  readonly path: string;
  readonly type: JsonType;
  readonly valueForms?: readonly string[];
}

export interface SchemaCustomField extends SchemaField {
  readonly name: string;
  readonly bareName: boolean;
}

export interface SchemaParameter {
  readonly name: string;
  readonly type: FunctionParameter["type"];
  readonly nullable?: true;
  readonly values?: readonly string[];
}

export interface SchemaFunction {
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly SchemaParameter[];
  readonly optional: readonly SchemaParameter[];
  readonly rest: SchemaParameter | null;
  readonly returns: FilterType | null;
}

export interface SchemaMethod extends SchemaFunction {
  readonly on: FilterValueType | "any";
  readonly scope?: readonly string[];
}

export interface SchemaProperty {
  readonly name: string;
  readonly on: FilterValueType;
  readonly description: string;
  readonly returns: FilterType;
}

export interface SchemaContextRecord {
  readonly name: "this.item" | "this.attachment";
  readonly dataset: "items" | "attachments";
  readonly members: readonly string[];
  readonly description: string;
}

export interface ItemQuerySchema {
  readonly context: readonly SchemaContextRecord[];
  readonly projectionPathGrammar: typeof PROJECTION_PATH_GRAMMAR;
  readonly fields: readonly SchemaField[];
  readonly customFields: readonly SchemaCustomField[];
  readonly functions: readonly SchemaFunction[];
  readonly methods: readonly SchemaMethod[];
  readonly properties: readonly SchemaProperty[];
  readonly types: readonly FilterValueType[];
  readonly defaults: {
    readonly fields: readonly string[];
    readonly sort: readonly SortSpec[];
    readonly limit: number | null;
  };
}

export const describeItemQuery: Effect.Effect<
  ItemQuerySchema,
  ItemQueryLayoutError | ItemQueryDatabaseError,
  ItemQueryDatabase
> = Effect.suspend(() => describeQuery(ITEMS, {}));

export function describeQuery<Vocabulary extends object>(
  dataset: QueryDataset,
  vocabulary: Vocabulary,
): Effect.Effect<
  Vocabulary & ItemQuerySchema,
  ItemQueryLayoutError | ItemQueryDatabaseError,
  ItemQueryDatabase
> {
  return Effect.map(describeQueryCustomFields(dataset), (customFields) => ({
    ...describeDatasetVocabulary(dataset),
    ...vocabulary,
    customFields,
    defaults: {
      fields: [...dataset.defaultFields],
      sort: dataset.defaultSort.map(({ field, direction }) => ({
        field,
        direction,
      })),
      limit: null,
    },
  }));
}

export function describeItemQueryVocabulary(): Omit<
  ItemQuerySchema,
  "customFields" | "defaults"
> {
  return describeDatasetVocabulary(ITEMS);
}

export function describeDatasetVocabulary(
  dataset: QueryDataset,
): Omit<ItemQuerySchema, "customFields" | "defaults"> {
  return {
    context: QUERY_CONTEXT,
    projectionPathGrammar: PROJECTION_PATH_GRAMMAR,
    fields: describeFields(dataset),
    functions: FUNCTIONS,
    methods: METHODS,
    properties: PROPERTIES,
    types: VALUE_TYPES,
  };
}

const QUERY_CONTEXT: readonly SchemaContextRecord[] = [
  {
    name: "this.item",
    dataset: "items",
    members: ["indexedKey", "key"],
    description:
      "The Item the caller binds, such as the Item of the note that shows the query. On Attachments and Annotations, item == this.item selects the records of that Item; on Items, indexedKey == this.item.indexedKey selects it. A filter that reads this.item when no Item is bound fails with unbound-context.",
  },
  {
    name: "this.attachment",
    dataset: "attachments",
    members: ["indexedKey", "key"],
    description:
      "The Attachment the caller binds, such as the Attachment open in the reader. On Annotations, attachment == this.attachment selects the Annotations of that Attachment; on Attachments, indexedKey == this.attachment.indexedKey selects it. A filter that reads this.attachment when no Attachment is bound fails with unbound-context.",
  },
];

const PROJECTION_PATH_GRAMMAR = {
  member: { syntax: ".name", description: "Read an object member." },
  index: {
    syntax: "[0]",
    description: "Read one list element by its zero-based index.",
  },
  key: {
    syntax: '["exact key"]',
    description: "Read an object member with a JSON-quoted key.",
  },
  each: {
    syntax: "[]",
    description:
      "Map the remaining path over each list element, preserving order and null positions. Repeat [] for nested lists.",
  },
} as const;

function describeFields(dataset: QueryDataset): SchemaField[] {
  const capability = (path: string): SchemaCapabilities["filter"] => {
    const plan = dataset.planFilter(path);
    if ("kind" in plan) return null;
    const type = plan.root.valueType;
    return type === "unknown" ? "any" : type === "null" ? null : type;
  };
  const fields = new Map<string, SchemaField>();
  for (const name of dataset.names) {
    const definition = dataset.definition(name);
    const filter = capability(name);
    if (!definition) {
      if (!fields.has(name))
        fields.set(name, {
          path: name,
          type: jsonTypeOf(filter),
          filter,
          projection: false,
          group: false,
          sort: false,
        });
      continue;
    }
    fields.set(name, {
      path: name,
      type: jsonType(definition.shape),
      filter,
      projection: true,
      group: definition.shape.kind === "scalar",
      sort: false,
      ...(definition.relation && { relation: definition.relation().id }),
      ...(definition.valueForms && { valueForms: definition.valueForms }),
      ...(definition.description && { description: definition.description }),
    });
    for (const field of pathsBelow(name, definition.shape, capability)) {
      fields.set(field.path, field);
    }
  }
  return [...fields.values()].map((field) => ({
    ...field,
    sort: dataset.sortable(field.path) !== undefined,
  }));
}

export function pathsBelow(
  path: string,
  shape: ValueShape,
  capability: (path: string) => SchemaCapabilities["filter"],
): SchemaField[] {
  const below = (child: string, childShape: ValueShape): SchemaField[] => [
    {
      path: child,
      ...(childShape.kind === "record" && {
        relation: childShape.vocabulary().id,
      }),
      type: jsonType(childShape),
      filter: capability(child),
      projection: true,
      group: canGroup(childShape, eachCount(child)),
      sort: false,
    },
    ...pathsBelow(child, childShape, capability),
  ];
  switch (shape.kind) {
    case "scalar":
    case "json":
    case "custom-fields":
      return [];
    case "record": {
      const vocabulary = shape.vocabulary();
      return vocabulary.projectionFields.flatMap((name) => {
        const definition = vocabulary.field(name)!;
        const child = `${path}.${name}`;
        return below(child, definition.shape).map((field) =>
          field.path === child && definition.valueForms
            ? { ...field, valueForms: definition.valueForms }
            : field,
        );
      });
    }
    case "object":
      return Object.entries(shape.keys).flatMap(([key, child]) =>
        below(`${path}.${key}`, child),
      );
    case "list":
      return [
        ...below(`${path}.length`, { kind: "scalar", type: "number" }),
        ...below(`${path}[0]`, shape.element),
        ...below(`${path}[]`, shape.element).map((field) => ({
          ...field,
          type: "array" as const,
        })),
      ];
  }
}

function eachCount(path: string): number {
  const parsed = parseProjectionPath(path);
  return parsed.ok
    ? parsed.segments.filter((segment) => typeof segment === "object").length
    : 0;
}

export function jsonType(shape: ValueShape): JsonType {
  switch (shape.kind) {
    case "scalar":
      return shape.type;
    case "json":
      return "any";
    case "object":
    case "record":
    case "custom-fields":
      return "object";
    case "list":
      return "array";
  }
}

function jsonTypeOf(type: SchemaCapabilities["filter"]): JsonType {
  return type === "list"
    ? "array"
    : type === "number" || type === "boolean"
      ? type
      : "string";
}

const parameter = ({
  name,
  type,
  nullable,
  values,
}: FunctionParameter): SchemaParameter => ({
  name,
  type,
  ...(nullable && { nullable }),
  ...(values && { values }),
});

function signature(
  definition: Pick<
    FunctionDefinition,
    "description" | "parameters" | "optional" | "rest" | "returns"
  >,
): Omit<SchemaFunction, "name"> {
  return {
    description: definition.description,
    parameters: definition.parameters.map(parameter),
    optional: (definition.optional ?? []).map(parameter),
    rest: definition.rest ? parameter(definition.rest) : null,
    returns: definition.returns,
  };
}

const FUNCTIONS: readonly SchemaFunction[] = [
  { name: "if", ...signature({ ...IF_FUNCTION, returns: null }) },
  ...[...GLOBAL_FUNCTIONS].map(([name, definition]) => ({
    name,
    ...signature(definition),
  })),
];

const METHODS: readonly SchemaMethod[] = METHOD_ENTRIES.map(
  ([on, name, definition]) => ({
    name,
    on,
    ...signature(definition),
    ...(definition.scope && { scope: definition.scope }),
  }),
);

const PROPERTIES: readonly SchemaProperty[] = PROPERTY_ENTRIES.map(
  ([on, name, property]) => ({
    name,
    on,
    description: property.description,
    returns: property.returns,
  }),
);
