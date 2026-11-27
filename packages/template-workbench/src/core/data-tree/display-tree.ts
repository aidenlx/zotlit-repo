import { formatAccessorPath, memberAccessor } from "@zotlit/db/template-data";
import type { TemplatePathSegment } from "@zotlit/db/template-data";
import { inertPlaceholderReason } from "@zotlit/db/template-data";
import { coerceToString } from "@zotlit/db/template-data";

import {
  evaluateHelper,
  isPlainObject,
  readList,
  shownTexts,
} from "./list-items.ts";

export type PathSegment = TemplatePathSegment;

export type DisplayValueType =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "undefined"
  | "array"
  | "object"
  | "opaque"
  | "getter";

interface DisplayNodeBase {
  readonly path: readonly PathSegment[];
  readonly key: string;
  readonly label: string;
}

export interface ValueNode extends DisplayNodeBase {
  readonly kind: "value";
  readonly valueType: DisplayValueType;
  readonly value: unknown;
  readonly expandable: boolean;
  readonly size?: number;
  readonly preview?: string;
  readonly children?: readonly DisplayNode[];
}

export interface HelperNode extends DisplayNodeBase {
  readonly kind: "helper";
  readonly signatureHint: string;
  readonly evaluated: string | null;
}

export interface ListPropertyNode extends DisplayNodeBase {
  readonly kind: "list-property";
  readonly list: readonly PathSegment[];
  readonly property: string;
  readonly values: readonly (string | null)[];
  readonly preview: string;
}

export interface PlaceholderNode extends DisplayNodeBase {
  readonly kind: "placeholder";
  readonly reason: string;
}

export type DisplayNode =
  | ValueNode
  | HelperNode
  | PlaceholderNode
  | ListPropertyNode;

export type ListLayout = "items" | "shape";

export interface BuildDisplayTreeOptions {
  readonly expanded: ReadonlySet<string>;
  readonly lists?: ListLayout;
}

interface Walk {
  readonly expanded: ReadonlySet<string>;
  readonly lists: ListLayout;
}

export function findAnnotationRoot<T extends { key: string }>(
  context: { annotations: readonly T[] },
  annotationKey: string,
): T | null {
  return context.annotations.find((a) => a.key === annotationKey) ?? null;
}

export function annotationKeyAtPath(
  context: { annotations: readonly { key: string }[] },
  path: readonly PathSegment[],
): string | null {
  if (path.length !== 2 || path[0] !== "annotations") return null;
  const index = path[1];
  if (typeof index !== "number") return null;
  return context.annotations[index]?.key ?? null;
}

export function buildDisplayTree(
  root: object,
  options: BuildDisplayTreeOptions,
): readonly DisplayNode[] {
  return buildChildren(root, [], {
    expanded: options.expanded,
    lists: options.lists ?? "items",
  });
}

export const formatPath = formatAccessorPath;

interface Entry {
  readonly segment: PathSegment;
  readonly isGetter: boolean;
  readonly read: () => unknown;
}

function entriesOf(container: object): Entry[] {
  return Array.isArray(container)
    ? container.map((value, i) => ({
        segment: i,
        isGetter: false,
        read: () => value,
      }))
    : Object.keys(container)
        .sort((a, b) => a.localeCompare(b))
        .map((key) => {
          const desc = Object.getOwnPropertyDescriptor(container, key)!;
          return {
            segment: key,
            isGetter: !!desc.get,
            read: desc.get ? () => desc.get!.call(container) : () => desc.value,
          };
        });
}

function buildChildren(
  container: object,
  parentPath: readonly PathSegment[],
  walk: Walk,
): DisplayNode[] {
  if (walk.lists === "shape" && Array.isArray(container))
    return listProperties(container, parentPath);
  return entriesOf(container).map((entry) =>
    buildNode(entry, parentPath, walk),
  );
}

function buildNode(
  entry: Entry,
  parentPath: readonly PathSegment[],
  walk: Walk,
): DisplayNode {
  const path = [...parentPath, entry.segment];
  const key = formatPath(path);
  const label = String(entry.segment);
  const isExpanded = walk.expanded.has(key);

  if (entry.isGetter && !isExpanded) {
    return {
      kind: "value",
      path,
      key,
      label,
      valueType: "getter",
      value: undefined,
      expandable: true,
    };
  }

  const value = entry.read();
  return classifyValue(value, { path, key, label }, walk);
}

function classifyValue(
  value: unknown,
  { path, key, label }: DisplayNodeBase,
  walk: Walk,
): DisplayNode {
  if (typeof value === "function") {
    const reason = inertPlaceholderReason(value);
    if (reason !== undefined) {
      return { kind: "placeholder", path, key, label, reason };
    }

    const fn = value as (...args: unknown[]) => unknown;
    return {
      kind: "helper",
      path,
      key,
      label,
      signatureHint: describeSignature(fn, label),
      evaluated: evaluateHelper(fn),
    };
  }

  const valueType = valueTypeOf(value);

  if (valueType !== "array" && valueType !== "object") {
    return {
      kind: "value",
      path,
      key,
      label,
      valueType,
      value,
      expandable: false,
    };
  }

  if (valueType === "object" && !isPlainObject(value as object)) {
    return {
      kind: "value",
      path,
      key,
      label,
      valueType: "opaque",
      value,
      expandable: false,
    };
  }

  const container = value as object;
  const size = Array.isArray(container)
    ? container.length
    : Object.keys(container).length;
  const expandable =
    walk.lists === "shape" && Array.isArray(container)
      ? readList(container).properties.length > 0
      : size > 0;
  const preview = containerPreview(container);

  const node: ValueNode = {
    kind: "value",
    path,
    key,
    label,
    valueType,
    value,
    expandable,
    size,
    ...(preview !== undefined ? { preview } : {}),
  };

  if (walk.expanded.has(key) && expandable) {
    return { ...node, children: buildChildren(container, path, walk) };
  }

  return node;
}

function valueTypeOf(value: unknown): DisplayValueType {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return t;
  return "object";
}

const PREVIEW_MAX_LENGTH = 80;

export function previewLine(text: string): string {
  const line = text.replaceAll(/\s+/g, " ").trim();
  return line.length > PREVIEW_MAX_LENGTH
    ? `${line.slice(0, PREVIEW_MAX_LENGTH)}…`
    : line;
}

function containerPreview(value: object): string | undefined {
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    return previewLine(readList(value).lines.join(", "));
  }
  if (!Object.hasOwn(value, "toString")) return undefined;
  const rendered = previewLine(coerceToString(value));
  if (!rendered || rendered === "[object Object]") return undefined;
  return rendered;
}

export function listPropertiesOf(node: DisplayNode): ListPropertyNode[] {
  return node.kind === "value" && Array.isArray(node.value)
    ? listProperties(node.value, node.path)
    : [];
}

function listProperties(
  list: readonly unknown[],
  listPath: readonly PathSegment[],
): ListPropertyNode[] {
  const listKey = formatPath(listPath);
  return readList(list).properties.map(({ name, values }) => ({
    kind: "list-property",
    path: [...listPath, name],
    key: `${listKey}[]${memberAccessor(name)}`,
    label: name,
    list: listPath,
    property: name,
    values,
    preview: previewLine(shownTexts(values).join(", ")),
  }));
}

const LINK_HELPER_SIGNATURE_HINTS: ReadonlySet<string> = new Set([
  "noteLink",
  "fileLink",
  "imgLink",
]);

function describeSignature(
  fn: (...args: never[]) => unknown,
  label: string,
): string {
  if (LINK_HELPER_SIGNATURE_HINTS.has(label)) return "ƒ(alias?, subpath?)";
  const n = fn.length;
  return n === 0 ? "ƒ()" : `ƒ(${Array(n).fill("·").join(", ")})`;
}

export function copyValue(node: DisplayNode): string | null {
  if (node.kind === "placeholder") return null;
  if (node.kind === "helper") return node.evaluated;
  if (node.kind === "list-property") return shownTexts(node.values).join("\n");

  switch (node.valueType) {
    case "getter":
      return null;
    case "string":
      return node.value as string;
    case "number":
    case "boolean":
      return String(node.value);
    case "null":
      return "null";
    case "undefined":
      return "undefined";
    case "opaque":
      return coerceToString(node.value);
    case "array":
    case "object":
      return stringifyContainer(node.value);
  }
}

function stringifyContainer(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    const seen = new WeakSet<object>();
    return JSON.stringify(
      value,
      (_key, v) => {
        if (typeof v !== "object" || v === null) return v;
        if (seen.has(v)) return undefined;
        seen.add(v);
        return v;
      },
      2,
    );
  }
}

export interface SearchedField {
  readonly label: string;
  readonly alias?: string;
  readonly path: readonly PathSegment[];
  readonly values?: readonly (string | null)[];
}

export function fieldMatches(query: string, field: SearchedField): boolean {
  const needle = query.toLowerCase();
  const has = (text: string) => text.toLowerCase().includes(needle);
  return (
    [field.label, field.alias ?? "", ...(field.values ?? [])].some(
      (text) => text !== null && has(text),
    ) ||
    (has(formatPath(field.path, "zt")) &&
      !has(formatPath(field.path.slice(0, -1), "zt")))
  );
}

export interface BuildFilteredDisplayTreeOptions {
  readonly collapsed?: ReadonlySet<string>;
  readonly aliases?: ReadonlyMap<string, string>;
  readonly lists?: ListLayout;
}

export function buildFilteredDisplayTree(
  root: object,
  query: string,
  options?: BuildFilteredDisplayTreeOptions,
): {
  nodes: readonly DisplayNode[];
  matchedKeys: ReadonlySet<string>;
} {
  const ctx: FilterContext = {
    query,
    matchedKeys: new Set(),
    activeContainers: new WeakSet(),
    collapsed: options?.collapsed ?? new Set(),
    aliases: options?.aliases ?? new Map(),
    lists: options?.lists ?? "items",
  };
  const nodes = filterChildren(root, [], ctx);
  return { nodes, matchedKeys: ctx.matchedKeys };
}

interface FilterContext {
  readonly query: string;
  readonly matchedKeys: Set<string>;
  readonly activeContainers: WeakSet<object>;
  readonly collapsed: ReadonlySet<string>;
  readonly aliases: ReadonlyMap<string, string>;
  readonly lists: ListLayout;
}

function filterChildren(
  container: object,
  parentPath: readonly PathSegment[],
  ctx: FilterContext,
): DisplayNode[] {
  if (ctx.activeContainers.has(container)) return [];
  ctx.activeContainers.add(container);

  const results: DisplayNode[] = [];
  for (const entry of entriesOf(container)) {
    const node = filterNode(entry, parentPath, ctx);
    if (node !== null) results.push(node);
  }
  ctx.activeContainers.delete(container);
  return results;
}

function filterNode(
  entry: Entry,
  parentPath: readonly PathSegment[],
  ctx: FilterContext,
): DisplayNode | null {
  const path = [...parentPath, entry.segment];
  const key = formatPath(path);
  const label = String(entry.segment);
  const alias = ctx.aliases.get(key);
  const field: SearchedField =
    alias === undefined ? { label, path } : { label, alias, path };
  const labelMatches = fieldMatches(ctx.query, field);
  const nodeBase = { path, key, label };

  if (entry.isGetter && labelMatches) {
    ctx.matchedKeys.add(key);
    return {
      kind: "value",
      ...nodeBase,
      valueType: "getter",
      value: undefined,
      expandable: true,
    };
  }

  const value = entry.read();

  if (typeof value === "function") {
    if (!labelMatches) return null;
    ctx.matchedKeys.add(key);
    return classifyValue(value, nodeBase, {
      expanded: new Set(),
      lists: ctx.lists,
    });
  }

  const valueType = valueTypeOf(value);

  if (valueType !== "array" && valueType !== "object") {
    const valueMatches = fieldMatches(ctx.query, {
      ...field,
      values: [stringifyPrimitive(value)],
    });
    if (!valueMatches) return null;
    ctx.matchedKeys.add(key);
    return classifyValue(value, nodeBase, {
      expanded: new Set(),
      lists: ctx.lists,
    });
  }

  if (valueType === "object" && !isPlainObject(value as object)) {
    if (!labelMatches) return null;
    ctx.matchedKeys.add(key);
    return classifyValue(value, nodeBase, {
      expanded: new Set(),
      lists: ctx.lists,
    });
  }

  const container = value as object;
  const size = Array.isArray(container)
    ? container.length
    : Object.keys(container).length;

  const shape = ctx.lists === "shape" && Array.isArray(container);
  const children = shape
    ? filterListProperties(container as unknown[], path, ctx)
    : size > 0
      ? filterChildren(container, path, ctx)
      : [];
  const reading = shape ? readList(container as unknown[]) : null;
  const itemsMatch =
    reading !== null &&
    reading.properties.length === 0 &&
    fieldMatches(ctx.query, { ...field, values: reading.lines });
  if (!labelMatches && !itemsMatch && children.length === 0) return null;
  if (labelMatches || itemsMatch) ctx.matchedKeys.add(key);

  const preview = containerPreview(container);
  const expandable = children.length > 0;
  const isCollapsed = expandable && ctx.collapsed.has(key);
  return {
    kind: "value",
    ...nodeBase,
    valueType,
    value,
    expandable,
    size,
    ...(preview !== undefined ? { preview } : {}),
    ...(expandable && !isCollapsed ? { children } : {}),
  };
}

function filterListProperties(
  list: readonly unknown[],
  listPath: readonly PathSegment[],
  ctx: FilterContext,
): ListPropertyNode[] {
  return listProperties(list, listPath).filter((node) => {
    const alias = ctx.aliases.get(node.key);
    const matches = fieldMatches(ctx.query, {
      label: node.label,
      ...(alias !== undefined && { alias }),
      path: node.path,
      values: node.values,
    });
    if (matches) ctx.matchedKeys.add(node.key);
    return matches;
  });
}

function stringifyPrimitive(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return coerceToString(value);
}
