import { inertPlaceholderReason } from "@zotlit/db/template-data";
import { coerceToString } from "@zotlit/db/template-data";

import type { DisplayNode } from "./display-tree.ts";

export const JOIN_SEPARATOR = ", ";

export function isList(node: DisplayNode): boolean {
  return (
    node.kind === "list-property" ||
    (node.kind === "value" && node.valueType === "array")
  );
}

export function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function itemReadsAsText(item: unknown): boolean {
  if (item === null || item === undefined) return false;
  if (typeof item !== "object") return true;
  if (Array.isArray(item)) return false;
  return Object.hasOwn(item, "toString") || !isPlainObject(item);
}

export function evaluateHelper(
  fn: (...args: unknown[]) => unknown,
): string | null {
  try {
    const result = fn();
    return result == null ? null : coerceToString(result);
  } catch {
    return null;
  }
}

export function valueText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "function") {
    if (inertPlaceholderReason(value) !== undefined) return "";
    return evaluateHelper(value as (...args: unknown[]) => unknown) ?? "";
  }
  if (typeof value !== "object") return coerceToString(value);
  if (!itemReadsAsText(value)) return "";
  const text = coerceToString(value);
  return text === "[object Object]" ? "" : text;
}

export function hasValue(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  return typeof value !== "string" || value.trim() !== "";
}

export function shownTexts(values: readonly (string | null)[]): string[] {
  return values.filter((text): text is string => text !== null && text !== "");
}

export interface ListProperty {
  readonly name: string;
  readonly values: readonly (string | null)[];
}

export interface ListReading {
  readonly readsAsText: boolean;
  readonly lineProperty: string | undefined;
  readonly lines: readonly string[];
  readonly properties: readonly ListProperty[];
}

export function readList(list: readonly unknown[]): ListReading {
  const readsAsText = list.every(itemReadsAsText);
  const records = list.filter(
    (item): item is object =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      isPlainObject(item),
  );
  const names = [
    ...new Set(records.flatMap((record) => Object.keys(record))),
  ].sort((a, b) => a.localeCompare(b));
  const lineProperty = readsAsText ? undefined : lineOf(names, records);
  const valuesOf = (name: string) =>
    list.map((item) => {
      const value = ownValue(item, name);
      return hasValue(value) ? valueText(value) : null;
    });
  return {
    readsAsText,
    lineProperty,
    lines: shownTexts(
      lineProperty === undefined ? list.map(valueText) : valuesOf(lineProperty),
    ),
    properties: names.map((name) => ({ name, values: valuesOf(name) })),
  };
}

function lineOf(
  names: readonly string[],
  records: readonly object[],
): string | undefined {
  const values = (name: string) =>
    records
      .map((record) => ownValue(record, name))
      .filter((value) => value !== undefined && value !== null && value !== "");
  const text = (value: unknown) =>
    typeof value !== "function" && itemReadsAsText(value);
  return (
    names.find((name) => {
      const present = values(name);
      return present.length > 0 && present.every(text);
    }) ??
    names.find((name) => values(name).some(text)) ??
    names[0]
  );
}

function ownValue(item: unknown, name: string): unknown {
  if (item === null || typeof item !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(item, name);
  return descriptor && !descriptor.get ? descriptor.value : undefined;
}
