import type {
  DisplayNode,
  SnippetKind,
  TemplateEngine,
} from "#core/data-tree/index.ts";

import { formatAccessorPath } from "@zotlit/db/template-data";

import {
  isList,
  JOIN_SEPARATOR,
  listItemTexts,
  listSnippetKinds,
  loopVariable,
  outputText,
  renderSnippet,
  snippetKindsFor,
  snippetResult,
} from "#core/data-tree/index.ts";

export type FieldInsertionMode = "template" | "expression" | "json-e";

export interface FieldInsertionContext {
  readonly engine: TemplateEngine;
  readonly mode: FieldInsertionMode;
}

export const TEMPLATE_INSERTION: FieldInsertionContext = {
  engine: "liquid",
  mode: "template",
};

export interface FieldForm {
  readonly kind: SnippetKind;
  readonly snippet: string;
  readonly result: string | null;
}

export interface FieldInsertOptions {
  readonly keepOpen: boolean;
}

export interface FieldFormsOptions {
  readonly every?: boolean;
}

export function fieldForms(
  node: DisplayNode,
  { engine, mode }: FieldInsertionContext,
  { every = false }: FieldFormsOptions = {},
): readonly FieldForm[] {
  if (mode !== "template")
    return [
      {
        kind: "output",
        snippet: valueSnippet(node, mode),
        result: valueOf(node),
      },
    ];
  const lists = listSnippetKinds(node);
  const kinds = every
    ? snippetKindsFor(node)
    : lists.length > 0
      ? lists
      : [snippetKindsFor(node)[0]!];
  return kinds.map((kind) => ({
    kind,
    snippet: renderSnippet(node, engine, kind),
    result: snippetResult(node, kind),
  }));
}

export function fieldForm(
  node: DisplayNode,
  context: FieldInsertionContext,
  kind?: SnippetKind,
): FieldForm {
  const forms = fieldForms(node, context);
  return forms.find((form) => form.kind === kind) ?? forms[0]!;
}

function valueSnippet(
  node: DisplayNode,
  mode: Exclude<FieldInsertionMode, "template">,
): string {
  if (node.kind === "list-property") {
    const list = formatAccessorPath(node.list, "zt");
    if (mode === "expression")
      return `${list} | map: ${JSON.stringify(node.property)}`;
    const item = loopVariable(node.list);
    return JSON.stringify({
      $map: { $eval: list },
      [`each(${item})`]: { $eval: formatAccessorPath([node.property], item) },
    });
  }
  const path = formatAccessorPath(node.path, "zt");
  return mode === "expression" ? path : JSON.stringify({ $eval: path });
}

function valueOf(node: DisplayNode): string | null {
  const text =
    isList(node) || node.kind === "list-property"
      ? listItemTexts(node).join(JOIN_SEPARATOR)
      : outputText(node);
  return text === "" ? null : text;
}
