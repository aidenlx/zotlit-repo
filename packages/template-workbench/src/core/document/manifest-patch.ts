import type { ChangeSpec } from "@codemirror/state";
import type { Document, Node, Pair, YAMLMap } from "yaml";
import { isMap, isNode, isScalar, isSeq, parseDocument, stringify } from "yaml";

import { literatureNoteTemplateManifestRange } from "@zotlit/templates/facade";

import { scalarSource, scalarStyle } from "./scalar-source.ts";

export type ManifestScalar = string | number | boolean | null;

export interface WorkbenchSliceRange {
  readonly from: number;
  readonly to: number;
}

export type ManagedEntryLanguage = "expr" | "value" | "js";

export interface ManagedEntrySource {
  readonly position: number;
  readonly key?: string;
  readonly language: ManagedEntryLanguage;
  readonly merge: string;
  readonly block: WorkbenchSliceRange;
  readonly expression: WorkbenchSliceRange;
}

export type ManagedEntryAction =
  | {
      readonly action: "add";
      readonly kind: "property" | "spread";
      readonly after?: number;
    }
  | { readonly action: "remove"; readonly position: number }
  | {
      readonly action: "move";
      readonly position: number;
      readonly to: number;
    }
  | {
      readonly action: "language";
      readonly position: number;
      readonly language: "expr" | "value";
      readonly text?: string;
    }
  | {
      readonly action: "set";
      readonly position: number;
      readonly field: "key" | "merge";
      readonly value: string;
    };

const NEW_EXPRESSION = "zt.title";
const NEW_RULE = '{"$eval":"zt.title"}';
const NEW_SPREAD =
  '{"kind":{"$eval":"zt.itemType"},"tags":{"$eval":"zt.tags"}}';

export function manifestValueEdit(
  source: string,
  path: readonly (string | number)[],
  value: ManifestScalar,
): ChangeSpec | null {
  const found = manifestNode(source, path);
  if (!found) return null;

  const { from, to } = found;
  return { from, to, insert: scalarText(value, source.slice(from, to)) };
}

export function manifestKeyEdit(
  source: string,
  key: string,
  value: ManifestScalar | undefined,
): ChangeSpec | null {
  const manifest = manifestYaml(source);
  if (!manifest || manifest.doc.errors.length > 0) return null;

  const pair = mapPair(manifest.doc.contents, key);
  if (!pair) {
    return value === undefined
      ? null
      : {
          from: manifest.end,
          to: manifest.end,
          insert: `${key}: ${scalarText(value, "")}\n`,
        };
  }
  if (
    !isScalar(pair.key) ||
    !pair.key.range ||
    !isScalar(pair.value) ||
    !pair.value.range
  ) {
    return null;
  }
  const [from, to] = pair.value.range;
  if (value !== undefined) {
    return {
      from: manifest.offset + from,
      to: contentEnd(source, manifest.offset + from, manifest.offset + to),
      insert: scalarText(
        value,
        source.slice(manifest.offset + from, manifest.offset + to),
      ),
    };
  }
  return {
    from: lineStart(source, manifest.offset + pair.key.range[0]),
    to: blockEnd(source, manifest.offset + to),
  };
}

export interface ManifestScalarSlice extends WorkbenchSliceRange {
  readonly literal: boolean;
}

export function manifestScalarSlice(
  source: string,
  path: readonly (string | number)[],
): ManifestScalarSlice | null {
  const found = manifestNode(source, path);
  if (!found || !isScalar(found.node)) return null;

  const { node, from, to } = found;
  if (node.srcToken?.type === "block-scalar") {
    const body = node.srcToken.source;
    const newline = body.indexOf("\n");
    if (newline < 0 || body.slice(newline).trim() !== "") return null;
    const line = body.slice(
      0,
      body[newline - 1] === "\r" ? newline - 1 : newline,
    );
    if (typeof node.value !== "string") return null;
    const [text = "", ...trailing] = node.value.split("\n");
    if (
      trailing.some((part) => part !== "") ||
      !line.endsWith(text) ||
      line.slice(0, line.length - text.length).trim() !== ""
    )
      return null;
    const end = to - body.length + line.length;
    return { from: end - text.length, to: end, literal: true };
  }
  if (typeof node.value === "string" && node.value.includes("\n")) return null;
  return { from, to: contentEnd(source, from, to), literal: false };
}

export function manifestNodeRange(
  source: string,
  path: readonly (string | number)[],
): WorkbenchSliceRange | null {
  const found = manifestNode(source, path);
  return found && { from: found.from, to: found.to };
}

export type ManagedFrontmatterList =
  | { readonly status: "rows"; readonly entries: readonly ManagedEntrySource[] }
  | { readonly status: "source-only" }
  | { readonly status: "unparsed" };

export function managedFrontmatterEntries(
  source: string,
): ManagedFrontmatterList {
  const read = readList(source);
  return read.status === "rows"
    ? { status: "rows", entries: read.list.entries.map(({ entry }) => entry) }
    : read;
}

export function followEntries(
  from: string,
  to: string,
): ((position: number) => number | undefined) | null {
  if (from === to) return null;
  const before = managedFrontmatterEntries(from);
  const after = managedFrontmatterEntries(to);
  if (before.status !== "rows" || after.status !== "rows") return null;
  const text = (source: string, { block }: ManagedEntrySource) =>
    source.slice(block.from, block.to);
  const unclaimed = Map.groupBy(
    after.entries.map((entry, index) => ({ text: text(to, entry), index })),
    (entry) => entry.text,
  );
  const target = before.entries.map(
    (entry) => unclaimed.get(text(from, entry))?.shift()?.index,
  );
  const claimed = new Set(target);
  const left = target.flatMap((found, index) =>
    found === undefined ? [index] : [],
  );
  const open = after.entries.flatMap((_, index) =>
    claimed.has(index) ? [] : [index],
  );
  for (const [order, index] of left.entries()) {
    if (left.length === open.length) target[index] = open[order];
    else if (open.includes(index)) target[index] = index;
  }
  if (
    before.entries.length === after.entries.length &&
    target.every((found, index) => found === index)
  )
    return null;
  return (position) => {
    const found = target[position - 1];
    return found === undefined ? undefined : found + 1;
  };
}

export function managedEntryEdit(
  source: string,
  action: ManagedEntryAction,
): ChangeSpec | null {
  const read = readList(source);
  if (read.status !== "rows") return null;
  const { list } = read;
  switch (action.action) {
    case "add":
      return addEntry(list, action);
    case "remove":
      return removeEntry(list, action.position);
    case "move":
      return moveEntry(source, list, action);
    case "language":
      return changeLanguage(list, action);
    case "set":
      return setField(source, list, action);
  }
}

interface ManagedEntryNode {
  readonly entry: ManagedEntrySource;
  readonly node: YAMLMap;
  readonly column: number;
}

interface ManagedList {
  readonly manifest: ManifestYaml;
  readonly entries: readonly ManagedEntryNode[];
  readonly indent: number;
  readonly keyEnd: number | null;
  readonly value: WorkbenchSliceRange | null;
}

type ReadList =
  | { readonly status: "rows"; readonly list: ManagedList }
  | Exclude<ManagedFrontmatterList, { status: "rows" }>;

interface ManifestYaml {
  readonly doc: Document;
  readonly offset: number;
  readonly end: number;
}

function manifestYaml(source: string): ManifestYaml | null {
  let range;
  try {
    range = literatureNoteTemplateManifestRange(source);
  } catch {
    return null;
  }
  return {
    doc: parseDocument(source.slice(range.from, range.to), {
      keepSourceTokens: true,
    }),
    offset: range.from,
    end: range.to,
  };
}

function manifestNode(
  source: string,
  path: readonly (string | number)[],
): { node: Node; from: number; to: number } | null {
  const manifest = manifestYaml(source);
  if (!manifest) return null;

  const node = manifest.doc.getIn(path, true);
  if (!isNode(node) || !node.range) return null;

  const [start, end] = node.range;
  return { node, from: manifest.offset + start, to: manifest.offset + end };
}

function readList(source: string): ReadList {
  const manifest = manifestYaml(source);
  if (!manifest || manifest.doc.errors.length > 0) {
    return { status: "unparsed" };
  }

  const rows = (list: ManagedList): ReadList => ({ status: "rows", list });
  const pair = mapPair(manifest.doc.contents, "frontmatter");
  if (!pair) {
    return rows({
      manifest,
      entries: [],
      indent: 2,
      keyEnd: null,
      value: null,
    });
  }
  const keyEnd =
    isScalar(pair.key) && pair.key.range
      ? manifest.offset + pair.key.range[1] + 1
      : null;
  const node = pair.value;
  if (!isNode(node) || !node.range || keyEnd === null) {
    return { status: "source-only" };
  }
  const value = {
    from: manifest.offset + node.range[0],
    to: manifest.offset + node.range[1],
  };
  const empty = { manifest, entries: [], keyEnd, value };
  if (isScalar(node) && node.value === null)
    return rows({ ...empty, indent: 2 });
  if (!isSeq(node)) return { status: "source-only" };
  if (node.items.length === 0) return rows({ ...empty, indent: 2 });
  const token = node.srcToken;
  if (token?.type !== "block-seq") return { status: "source-only" };

  const entries: ManagedEntryNode[] = [];
  for (const [index, item] of node.items.entries()) {
    const marker = token.items[index]?.start.find(
      (part) => part.type === "seq-item-ind",
    );
    if (!marker) return { status: "source-only" };
    const entry = readEntry(source, manifest, {
      item,
      index,
      marker: manifest.offset + marker.offset,
    });
    if (!entry) return { status: "source-only" };
    entries.push(entry);
  }
  return rows({ manifest, entries, indent: token.indent, keyEnd, value });
}

function readEntry(
  source: string,
  manifest: ManifestYaml,
  { item, index, marker }: { item: unknown; index: number; marker: number },
): ManagedEntryNode | null {
  if (!isMap(item) || item.srcToken?.type !== "block-map" || !item.range) {
    return null;
  }
  const language = (["expr", "value", "js"] as const).find((name) =>
    item.has(name),
  );
  const field = language && mapPair(item, language);
  if (!field || !isNode(field.value) || !field.value.range) return null;

  const key = item.get("key");
  const merge = item.get("merge");
  const start = manifest.offset + item.range[0];
  const expression = manifest.offset + field.value.range[0];
  return {
    node: item,
    column: start - lineStart(source, start),
    entry: {
      position: index + 1,
      ...(typeof key === "string" ? { key } : {}),
      language,
      merge: typeof merge === "string" ? merge : "replace",
      block: {
        from: lineStart(source, marker),
        to: blockEnd(source, manifest.offset + item.range[1]),
      },
      expression: {
        from: expression,
        to: contentEnd(
          source,
          expression,
          manifest.offset + field.value.range[1],
        ),
      },
    },
  };
}

function addEntry(
  list: ManagedList,
  { kind, after }: { kind: "property" | "spread"; after?: number },
): ChangeSpec | null {
  const indent = " ".repeat(list.indent);
  const text =
    kind === "spread"
      ? `${indent}- value: ${NEW_SPREAD}\n`
      : `${indent}- key: ${freshKey(list)}\n${indent}  expr: ${NEW_EXPRESSION}\n`;

  if (list.entries.length > 0) {
    const at =
      after === undefined
        ? list.entries.at(-1)!.entry.block.to
        : entryAt(list, after)?.entry.block.to;
    return at === undefined ? null : { from: at, to: at, insert: text };
  }
  if (list.keyEnd === null || !list.value) {
    return {
      from: list.manifest.end,
      to: list.manifest.end,
      insert: `frontmatter:\n${text}`,
    };
  }
  return {
    from: list.keyEnd,
    to: list.value.to,
    insert: `\n${text.slice(0, -1)}`,
  };
}

function removeEntry(list: ManagedList, position: number): ChangeSpec | null {
  const target = entryAt(list, position);
  if (!target) return null;
  const { block } = target.entry;
  if (list.entries.length > 1) return { from: block.from, to: block.to };
  return [
    { from: list.keyEnd!, to: list.keyEnd!, insert: " []" },
    { from: block.from, to: block.to },
  ];
}

function moveEntry(
  source: string,
  list: ManagedList,
  { position, to }: { position: number; to: number },
): ChangeSpec | null {
  if (position === to || !entryAt(list, position) || !entryAt(list, to))
    return null;
  const run = list.entries
    .slice(Math.min(position, to) - 1, Math.max(position, to))
    .map(({ entry }) => entry.block);
  const blocks = run.map(({ from, to }) => source.slice(from, to));
  const order =
    position < to
      ? [...blocks.slice(1), blocks[0]!]
      : [blocks.at(-1)!, ...blocks.slice(0, -1)];
  return {
    from: run[0]!.from,
    to: run.at(-1)!.to,
    insert: order
      .map((block, index) =>
        index === 0
          ? block
          : source.slice(run[index - 1]!.to, run[index]!.from) + block,
      )
      .join(""),
  };
}

function changeLanguage(
  list: ManagedList,
  {
    position,
    language,
    text,
  }: { position: number; language: "expr" | "value"; text?: string },
): ChangeSpec | null {
  const target = entryAt(list, position);
  if (!target) return null;
  if (
    (language === "expr" || text !== undefined) &&
    target.entry.key === undefined
  )
    return null;

  const field = mapPair(target.node, target.entry.language);
  if (!field || !isScalar(field.key) || !field.key.range) return null;
  if (
    target.entry.language === language &&
    text === undefined &&
    !(
      language === "value" &&
      isScalar(field.value) &&
      typeof field.value.value === "string"
    )
  )
    return null;
  return {
    from: list.manifest.offset + field.key.range[0],
    to: target.entry.expression.to,
    insert:
      language === "expr"
        ? `expr: ${NEW_EXPRESSION}`
        : `value: ${text === undefined ? NEW_RULE : JSON.stringify(text)}`,
  };
}

function setField(
  source: string,
  list: ManagedList,
  {
    position,
    field,
    value,
  }: { position: number; field: "key" | "merge"; value: string },
): ChangeSpec | null {
  const target = entryAt(list, position);
  if (!target) return null;

  const pair = mapPair(target.node, field);
  if (pair && isNode(pair.value) && pair.value.range) {
    const from = list.manifest.offset + pair.value.range[0];
    const to = contentEnd(
      source,
      from,
      list.manifest.offset + pair.value.range[1],
    );
    return { from, to, insert: scalarText(value, source.slice(from, to)) };
  }
  const { block } = target.entry;
  return {
    from: block.to,
    to: block.to,
    insert: `${" ".repeat(target.column)}${field}: ${scalarText(value, "")}\n`,
  };
}

function entryAt(list: ManagedList, position: number): ManagedEntryNode | null {
  return list.entries[position - 1] ?? null;
}

function freshKey(list: ManagedList): string {
  const taken = new Set(list.entries.map(({ entry }) => entry.key));
  let key = "property";
  for (let index = 2; taken.has(key); index++) key = `property${index}`;
  return key;
}

function scalarText(value: ManifestScalar, previous: string): string {
  if (typeof value !== "string") return stringify(value).trimEnd();
  return scalarSource(value, scalarStyle(previous));
}

function mapPair(node: unknown, name: string): Pair | null {
  if (!isMap(node)) return null;
  return (
    node.items.find((item) => isScalar(item.key) && item.key.value === name) ??
    null
  );
}

function lineStart(source: string, at: number): number {
  return source.lastIndexOf("\n", at - 1) + 1;
}

function contentEnd(source: string, from: number, to: number): number {
  return from + source.slice(from, to).trimEnd().length;
}

function blockEnd(source: string, at: number): number {
  const next = source.indexOf("\n", Math.max(at - 1, 0));
  return next === -1 ? source.length : next + 1;
}
