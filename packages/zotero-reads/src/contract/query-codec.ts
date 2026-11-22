import { Predicate, Schema, SchemaGetter } from "effect";

import { nameDictionary } from "@zotlit/item-query";
import type { NameDictionary } from "@zotlit/item-query";
import { DELIMITED_FORMATS } from "@zotlit/shared/delimited";

import { libraryScopeWire } from "./library-scope.ts";

export const QUERY_DATASETS = ["items", "attachments", "annotations"] as const;

const NamedLibraries = Schema.Struct({
  scope: libraryScopeWire,
  parameter: Schema.Literal("library"),
});
export type NamedLibraries = typeof NamedLibraries.Type;

const Formulas = Schema.declare(
  (input: unknown): input is Readonly<Record<string, string>> =>
    Predicate.isObject(input) &&
    Object.values(input).every((text) => typeof text === "string"),
).pipe(
  Schema.decodeTo(
    Schema.declare((input: unknown): input is NameDictionary<string> =>
      Predicate.isObject(input),
    ),
    {
      decode: SchemaGetter.transform((record) =>
        nameDictionary(Object.entries(record)),
      ),
      encode: SchemaGetter.transform((dictionary) => ({ ...dictionary })),
    },
  ),
);

export const DecodedQuery = Schema.Struct({
  from: Schema.Literals(QUERY_DATASETS),
  libraries: Schema.NullOr(NamedLibraries),
  limit: Schema.NullOr(Schema.Int),
  group: Schema.optionalKey(Schema.String),
  filter: Schema.optionalKey(Schema.String),
  fields: Schema.optionalKey(Schema.Array(Schema.String)),
  formulas: Schema.optionalKey(Formulas),
  sort: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        field: Schema.String,
        direction: Schema.Literals(["asc", "desc"]),
      }),
    ),
  ),
  output: Schema.optionalKey(Schema.String),
  format: Schema.optionalKey(Schema.Literals(DELIMITED_FORMATS)),
  id: Schema.optionalKey(Schema.String),
  context: Schema.optionalKey(
    Schema.Struct({
      item: Schema.optionalKey(Schema.String),
      attachment: Schema.optionalKey(Schema.String),
    }),
  ),
});
export type DecodedQuery = typeof DecodedQuery.Type;

export const DecodedValues = Schema.Struct({
  kind: Schema.Literals(["collections", "tags"]),
  match: Schema.optionalKey(Schema.String),
  limit: Schema.NullOr(Schema.Int),
  libraries: Schema.NullOr(NamedLibraries),
});
export type DecodedValues = typeof DecodedValues.Type;
