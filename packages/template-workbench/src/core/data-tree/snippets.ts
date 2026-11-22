import {
  formatAccessorPath,
  isAccessorIdentifier,
} from "@zotlit/db/template-data";
import type { TemplatePathSegment } from "@zotlit/db/template-data";
import { coerceToString } from "@zotlit/db/template-data";

import type { DisplayNode, ListPropertyNode } from "./display-tree.ts";
import { JOIN_SEPARATOR, readList, shownTexts } from "./list-items.ts";

const LIST_LINE = "- ";

export type TemplateEngine = "liquid" | "eta";

export type SnippetKind = "output" | "if-present" | "loop" | "joined";

export function snippetKindsFor(node: DisplayNode): SnippetKind[] {
  if (node.kind === "list-property")
    return node.property === BACKLINK ? ["loop"] : ["joined", "loop"];
  if (node.kind === "helper" || node.kind === "placeholder") {
    return ["output", "if-present"];
  }
  if (node.valueType === "array") {
    return readList(itemsOf(node)).readsAsText ? ["joined", "loop"] : ["loop"];
  }
  return ["output", "if-present"];
}

export function listSnippetKinds(node: DisplayNode): SnippetKind[] {
  return snippetKindsFor(node).filter(
    (kind) => kind === "joined" || kind === "loop",
  );
}

export function renderSnippet(
  node: DisplayNode,
  engine: TemplateEngine,
  kind: SnippetKind,
): string {
  if (node.kind === "list-property")
    return listPropertySnippet(node, engine, kind);
  const accessor = formatAccessorPath(node.path, "zt");
  const show = showOfNode(node);
  switch (kind) {
    case "output":
      return show(interpolate(engine, callForm(node, engine, accessor)));
    case "if-present":
      return guard(engine, callForm(node, engine, accessor), show);
    case "loop": {
      const item = loopVariable(node.path);
      const property = readList(itemsOf(node)).lineProperty;
      const body =
        property === undefined ? item : formatAccessorPath([property], item);
      return loop(engine, accessor, {
        item,
        body,
        show: showOf(property),
        guarded: property !== undefined,
      });
    }
    case "joined":
      return joined(engine, accessor);
  }
}

function listPropertySnippet(
  node: ListPropertyNode,
  engine: TemplateEngine,
  kind: SnippetKind,
): string {
  const accessor = formatAccessorPath(node.list, "zt");
  const item = loopVariable(node.list);
  const value = formatAccessorPath([node.property], item);
  if (kind === "loop")
    return loop(engine, accessor, {
      item,
      body: value,
      show: showOf(node.property),
      guarded: true,
    });
  const separator = JSON.stringify(JOIN_SEPARATOR);
  return engine === "liquid"
    ? `{{ ${accessor} | map: ${JSON.stringify(node.property)} | where_exp: "value", ${JSON.stringify(present(engine, "value"))} | join: ${separator} }}`
    : `<%= ${accessor}.map((${item}) => ${value}).filter((value) => ${present(engine, "value")}).join(${separator}) %>`;
}

function present(engine: TemplateEngine, expr: string): string {
  return engine === "liquid"
    ? `${expr} != blank`
    : `${expr} != null && ${expr} !== false && String(${expr}).trim() !== ""`;
}

const BACKLINK = "backlink";

function showOf(
  key: TemplatePathSegment | undefined,
): (output: string) => string {
  return key === BACKLINK ? asZoteroLink : (output) => output;
}

function showOfNode(node: DisplayNode): (output: string) => string {
  return showOf(node.kind === "value" ? node.path.at(-1) : undefined);
}

function asZoteroLink(output: string): string {
  return `[Zotero](${output})`;
}

function callForm(
  node: DisplayNode,
  engine: TemplateEngine,
  accessor: string,
): string {
  const isHelper = node.kind === "helper" || node.kind === "placeholder";
  return engine === "eta" && isHelper ? `${accessor}()` : accessor;
}

function interpolate(engine: TemplateEngine, expr: string): string {
  return engine === "liquid" ? `{{ ${expr} }}` : `<%= ${expr} %>`;
}

function guard(
  engine: TemplateEngine,
  expr: string,
  show: (output: string) => string,
): string {
  const output = show(interpolate(engine, expr));
  return engine === "liquid"
    ? `{% if ${expr} %}${output}{% endif %}`
    : `<% if (${expr}) { %>${output}<% } %>`;
}

function loop(
  engine: TemplateEngine,
  accessor: string,
  {
    item,
    body,
    show,
    guarded = false,
  }: {
    item: string;
    body: string;
    show: (output: string) => string;
    guarded?: boolean;
  },
): string {
  if (engine === "liquid") {
    const line = `\n${LIST_LINE}${show(`{{ ${body} }}`)}`;
    const each = guarded
      ? `{% if ${present(engine, body)} %}${line}{% endif %}`
      : line;
    return `{% for ${item} in ${accessor} %}${each}{% endfor %}`;
  }
  const line = `\n${LIST_LINE}${show(`<%= ${body} %>`)}`;
  const each = guarded
    ? `<% if (${present(engine, body)}) { %>${line}<% } %>`
    : line;
  return `<% for (const ${item} of ${accessor}) { %>${each}<% } %>`;
}

function itemsOf(node: DisplayNode): readonly unknown[] {
  return node.kind === "value" && Array.isArray(node.value) ? node.value : [];
}

function joined(engine: TemplateEngine, accessor: string): string {
  return engine === "liquid"
    ? `{{ ${accessor} | join: ${JSON.stringify(JOIN_SEPARATOR)} }}`
    : `<%= ${accessor}.join(${JSON.stringify(JOIN_SEPARATOR)}) %>`;
}

export function loopVariable(path: DisplayNode["path"]): string {
  const last = path.at(-1);
  if (
    typeof last === "string" &&
    isAccessorIdentifier(last) &&
    last.length > 1 &&
    last.endsWith("s")
  ) {
    return last.slice(0, -1);
  }
  return "item";
}

export function snippetResult(
  node: DisplayNode,
  kind: SnippetKind,
): string | null {
  const text =
    kind === "loop"
      ? listItemTexts(node)
          .map((item) => `${LIST_LINE}${showOf(lineKey(node))(item)}`)
          .join("\n")
      : kind === "joined" || node.kind === "list-property"
        ? listItemTexts(node).join(JOIN_SEPARATOR)
        : outputResult(node);
  return text === "" ? null : text;
}

export function outputText(
  node: Exclude<DisplayNode, ListPropertyNode>,
): string {
  if (node.kind === "placeholder") return node.reason;
  if (node.kind === "helper") return node.evaluated ?? "";
  switch (node.valueType) {
    case "getter":
    case "null":
    case "undefined":
      return "";
    default:
      return coerceToString(node.value);
  }
}

function outputResult(node: Exclude<DisplayNode, ListPropertyNode>): string {
  const text = outputText(node);
  return text === "" ? text : showOfNode(node)(text);
}

function lineKey(node: DisplayNode): string | undefined {
  return node.kind === "list-property"
    ? node.property
    : readList(itemsOf(node)).lineProperty;
}

export function listItemTexts(node: DisplayNode): readonly string[] {
  return shownTexts(listItemValues(node));
}

export function listItemValues(node: DisplayNode): readonly (string | null)[] {
  if (node.kind === "list-property") return node.values;
  return readList(itemsOf(node)).lines;
}
