import type { SyntaxNode } from "@lezer/common";

import { matchesSearchTerm, resultText } from "@zotlit/item-query";
import type {
  ContextRecord,
  FilterValueType,
  FunctionDefinition,
  QueryDataset,
} from "@zotlit/item-query";

import { matchScore } from "./matching.ts";
import type { Span } from "./span.ts";

export const VAULT_SEGMENT = "vault";

export interface ExpressionField {
  readonly path: string;
  readonly label?: string;
  readonly type?: string;
  readonly searchTerms?: readonly string[];
}

export interface ExpressionName {
  readonly name: string;
  readonly label?: string;
}

export interface ExpressionVocabulary {
  readonly fields: readonly ExpressionField[];
  readonly context: readonly ContextRecord[];
  readonly formulas: readonly ExpressionName[];
  readonly vault?: readonly ExpressionName[];
  readonly custom?: {
    readonly path: string;
    readonly names: readonly string[];
  };
  readonly receiver?: (
    source: string,
    at: Span,
  ) => ExpressionReceiver | undefined;
}

export interface ExpressionReceiver {
  readonly type: FilterValueType | undefined;
  readonly members?: readonly ExpressionField[];
}

export interface ExpressionOption {
  readonly label: string;
  readonly insert: string;
  readonly caret?: number;
  readonly kind:
    | "field"
    | "namespace"
    | "function"
    | "method"
    | "property"
    | "key"
    | "variable";
  readonly type?: string;
  readonly note?: string;
  readonly searchTerms?: readonly string[];
}

export interface Caret {
  readonly inner: SyntaxNode;
  readonly pos: number;
  readonly source: string;
}

export function datasetCustomFields(
  dataset: Pick<QueryDataset, "customPrefix">,
  names: readonly string[],
): NonNullable<ExpressionVocabulary["custom"]> {
  return { path: `${dataset.customPrefix}custom`, names };
}

export interface ExpressionCompletionResult {
  readonly from: number;
  readonly to: number;
  readonly options: readonly ExpressionOption[];
}

export function signature(
  name: string,
  definition: Pick<FunctionDefinition, "parameters" | "optional" | "rest"> & {
    returns?: FunctionDefinition["returns"];
  },
): string {
  return `${name}(${takesArguments(definition) ? "…" : ""}) → ${resultText(definition.returns)}`;
}

export const takesArguments = (
  definition: Pick<FunctionDefinition, "parameters" | "optional" | "rest">,
): boolean =>
  definition.parameters.length > 0 ||
  (definition.optional?.length ?? 0) > 0 ||
  definition.rest !== undefined;

export function noteOf(name: string, label: string | undefined) {
  return label === undefined || label === name ? {} : { note: label };
}

export const fieldOption = ({
  path,
  label,
  type,
  searchTerms,
}: ExpressionField): ExpressionOption => ({
  label: path,
  insert: path,
  kind: "field",
  ...(type === undefined ? {} : { type }),
  ...noteOf(path, label),
  ...(searchTerms && { searchTerms }),
});

export const optionTexts = (option: ExpressionOption): readonly string[] =>
  (option.kind === "field" || option.kind === "namespace") &&
  option.note !== undefined
    ? [option.label, option.note]
    : [option.label];

function searchTermScore(option: ExpressionOption, query: string): number {
  const terms = option.searchTerms ?? [];
  if (terms.includes(query.toLowerCase())) return 0.5;
  return terms.some((term) => matchesSearchTerm(term, query)) ? 1.5 : Infinity;
}

function rankedBy<T>(
  items: readonly T[],
  query: string,
  score: (item: T) => number,
): T[] {
  return items
    .map((item, order) => ({ item, order, score: query ? score(item) : 0 }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map(({ item }) => item);
}

export function ranked<T>(
  items: readonly T[],
  query: string,
  texts: (item: T) => readonly string[],
): T[] {
  return rankedBy(items, query, (item) =>
    Math.min(...texts(item).map((text) => matchScore(text, query))),
  );
}

export function rankedOptions(
  options: readonly ExpressionOption[],
  query: string,
): ExpressionOption[] {
  return rankedBy(options, query, (option) =>
    Math.min(
      searchTermScore(option, query),
      ...optionTexts(option).map((text) => matchScore(text, query)),
    ),
  );
}
