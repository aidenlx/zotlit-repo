import * as v from "valibot";
import { parse, stringify } from "yaml";

import { readFilterTree } from "@zotlit/filter-expression";
import type { FilterTree } from "@zotlit/filter-expression";
import { FORMULA_SEGMENT, nameDictionary } from "@zotlit/item-query";
import type { NameDictionary } from "@zotlit/item-query";
import { VAULT_SEGMENT } from "@zotlit/template-workbench/core/language/index.ts";
import type { PlacedFault } from "@zotlit/template-workbench/core/language/index.ts";

export const QUERY_FILE_EXTENSION = "zotquery";

export function untitledName(
  base: string,
  taken: (name: string) => boolean,
): string {
  for (let index = 0; ; index++) {
    const name = index === 0 ? base : `${base} ${index}`;
    if (!taken(name)) return name;
  }
}

export const LITERATURE_NOTE = "vault.literatureNote";

export const NEW_QUERY_FILE_LIMIT = 100;

export const QUERY_FILE_DATASETS = [
  "annotations",
  "attachments",
  "items",
] as const;
export type QueryFileDataset = (typeof QUERY_FILE_DATASETS)[number];

export type QueryFileDirection = "ASC" | "DESC";

export type QueryFileGroupValue = string | null;

export interface QueryFileSort {
  readonly property: string;
  readonly direction: QueryFileDirection;
}

export function sameSort(
  a: readonly QueryFileSort[],
  b: readonly QueryFileSort[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      ({ property, direction }, at) =>
        property === b[at]!.property && direction === b[at]!.direction,
    )
  );
}

export type QueryFileProblem =
  | { readonly code: "invalid-yaml"; readonly message: string }
  | { readonly code: "not-a-map" }
  | { readonly code: "no-views" }
  | { readonly code: "missing-key"; readonly key: string }
  | {
      readonly code: "invalid-value";
      readonly key: string;
      readonly value: unknown;
    }
  | { readonly code: "duplicate-view-name"; readonly name: string };

export type ColumnSizes = Readonly<Record<string, number>>;

export interface QueryFileView {
  readonly type: string;
  readonly name: string;
  readonly from: QueryFileDataset | undefined;
  readonly filters?: FilterTree;
  readonly sort?: readonly QueryFileSort[];
  readonly groupBy?: QueryFileSort;
  readonly groupOrder?: readonly QueryFileGroupValue[];
  readonly limit?: number;
  readonly order?: readonly string[];
  readonly columnSize?: ColumnSizes;
  readonly problems: readonly QueryFileProblem[];
  readonly source: Readonly<Record<string, unknown>>;
}

export interface QueryFile {
  readonly filters?: FilterTree;
  readonly formulas?: NameDictionary<string>;
  readonly properties?: NameDictionary<unknown>;
  readonly views: readonly QueryFileView[];
  readonly problems: readonly QueryFileProblem[];
  readonly source: Readonly<Record<string, unknown>>;
}

type Entries = Record<string, unknown>;

function isMap(value: unknown): value is Entries {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDirection(value: unknown): QueryFileDirection | null {
  if (value === undefined) return "ASC";
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  return upper === "ASC" || upper === "DESC" ? upper : null;
}

function readSort(value: unknown): QueryFileSort | null {
  if (!isMap(value) || typeof value.property !== "string") return null;
  const direction = readDirection(value.direction);
  return direction ? { property: value.property, direction } : null;
}

const ColumnWidth = v.pipe(v.number(), v.integer(), v.minValue(1));

function readColumnSize(value: unknown): ColumnSizes | undefined {
  if (!isMap(value)) return undefined;
  const sizes = Object.entries(value).filter(
    (entry): entry is [string, number] => v.is(ColumnWidth, entry[1]),
  );
  return sizes.length > 0 ? Object.fromEntries(sizes) : undefined;
}

function readView(value: unknown): QueryFileView {
  const source = isMap(value) ? value : {};
  const problems: QueryFileProblem[] = [];
  const invalid = (key: string) =>
    problems.push({ code: "invalid-value", key, value: source[key] });
  const text = (key: string): string => {
    const entry = source[key];
    if (entry === undefined || entry === null || entry === "") {
      problems.push({ code: "missing-key", key });
      return "";
    }
    if (typeof entry !== "string") {
      invalid(key);
      return JSON.stringify(entry);
    }
    return entry;
  };

  const type = text("type");
  const name = text("name");
  let from: QueryFileDataset | undefined;
  const fromText = text("from");
  if (fromText !== "") {
    if ((QUERY_FILE_DATASETS as readonly string[]).includes(fromText))
      from = fromText as QueryFileDataset;
    else if (typeof source.from === "string") invalid("from");
  }

  const view: {
    -readonly [K in keyof QueryFileView]: QueryFileView[K];
  } = { type, name, from, problems, source };

  if (source.filters !== undefined) {
    const filters = readFilterTree(source.filters);
    if (filters === null) invalid("filters");
    else view.filters = filters;
  }
  if (source.sort !== undefined) {
    const sort = Array.isArray(source.sort) ? source.sort.map(readSort) : null;
    if (sort === null || sort.includes(null)) invalid("sort");
    else view.sort = sort as QueryFileSort[];
  }
  if (source.groupBy !== undefined) {
    const groupBy = readSort(source.groupBy);
    if (groupBy === null) invalid("groupBy");
    else view.groupBy = groupBy;
  }
  if (source.groupOrder !== undefined) {
    const order = source.groupOrder;
    if (
      Array.isArray(order) &&
      order.every((value) => value === null || typeof value === "string")
    )
      view.groupOrder = order as QueryFileGroupValue[];
    else invalid("groupOrder");
  }
  if (source.limit !== undefined) {
    const { limit } = source;
    if (typeof limit === "number" && Number.isInteger(limit) && limit > 0)
      view.limit = limit;
    else invalid("limit");
  }
  if (source.order !== undefined) {
    const { order } = source;
    if (
      Array.isArray(order) &&
      order.every((entry) => typeof entry === "string" && entry !== "")
    )
      view.order = order as string[];
    else invalid("order");
  }
  const columnSize = readColumnSize(source.columnSize);
  if (columnSize) view.columnSize = columnSize;
  return view;
}

export function parseQueryFile(text: string): QueryFile {
  let value: unknown;
  try {
    value = parse(text);
  } catch (error) {
    return {
      views: [],
      problems: [
        {
          code: "invalid-yaml",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      source: {},
    };
  }
  if (value === null || value === undefined) value = {};
  if (!isMap(value))
    return { views: [], problems: [{ code: "not-a-map" }], source: {} };

  const problems: QueryFileProblem[] = [];
  const file: { -readonly [K in keyof QueryFile]: QueryFile[K] } = {
    views: [],
    problems,
    source: value,
  };
  if (value.filters !== undefined) {
    const filters = readFilterTree(value.filters);
    if (filters === null)
      problems.push({
        code: "invalid-value",
        key: "filters",
        value: value.filters,
      });
    else file.filters = filters;
  }
  if (value.formulas !== undefined) {
    const { formulas } = value;
    if (
      isMap(formulas) &&
      Object.values(formulas).every((text) => typeof text === "string")
    )
      file.formulas = nameDictionary(
        Object.entries(formulas as Record<string, string>),
      );
    else
      problems.push({
        code: "invalid-value",
        key: "formulas",
        value: formulas,
      });
  }
  if (value.properties !== undefined) {
    const { properties } = value;
    if (isMap(properties))
      file.properties = nameDictionary(Object.entries(properties));
    else
      problems.push({
        code: "invalid-value",
        key: "properties",
        value: properties,
      });
  }
  if (value.views !== undefined && !Array.isArray(value.views))
    problems.push({ code: "invalid-value", key: "views", value: value.views });
  file.views = Array.isArray(value.views) ? value.views.map(readView) : [];
  if (file.views.length === 0 && problems.length === 0)
    problems.push({ code: "no-views" });
  const names = new Set<string>();
  const duplicates = new Set<string>();
  for (const { name } of file.views)
    if (name) (names.has(name) ? duplicates : names).add(name);
  for (const name of duplicates)
    problems.push({ code: "duplicate-view-name", name });
  return file;
}

function merged(source: Readonly<Entries>, entries: Entries): Entries {
  const out: Entries = {};
  for (const key of Object.keys(source)) {
    const value = Object.hasOwn(entries, key) ? entries[key] : source[key];
    if (value !== undefined) out[key] = value;
  }
  for (const [key, value] of Object.entries(entries))
    if (!Object.hasOwn(source, key) && value !== undefined) out[key] = value;
  return out;
}

function writeView(view: QueryFileView): Entries {
  return merged(view.source, {
    type: view.type || undefined,
    name: view.name || undefined,
    from: view.from ?? view.source.from,
    filters: view.filters ?? view.source.filters,
    sort: view.sort?.map((sort) => ({ ...sort })) ?? view.source.sort,
    groupBy: view.groupBy ? { ...view.groupBy } : view.source.groupBy,
    groupOrder: view.groupOrder ? [...view.groupOrder] : view.source.groupOrder,
    limit: view.limit ?? view.source.limit,
    order: view.order ? [...view.order] : view.source.order,
    columnSize: view.columnSize
      ? { ...view.columnSize }
      : view.source.columnSize,
  });
}

export type QueryFileViewEdit = Partial<
  Pick<
    QueryFileView,
    "sort" | "groupBy" | "groupOrder" | "order" | "limit" | "columnSize"
  >
>;

export function editView(
  file: QueryFile,
  view: QueryFileView,
  edit: QueryFileViewEdit,
): QueryFile {
  const changes: {
    -readonly [K in keyof QueryFileViewEdit]: QueryFileViewEdit[K];
  } = { ...edit };
  if (
    Object.hasOwn(edit, "groupBy") &&
    edit.groupBy?.property !== view.groupBy?.property
  )
    changes.groupOrder = undefined;
  const source: Entries = { ...view.source };
  for (const [key, value] of Object.entries(changes))
    if (value === undefined) delete source[key];
  const problems = view.problems.filter(
    (problem) =>
      !(
        problem.code === "invalid-value" && Object.hasOwn(changes, problem.key)
      ),
  );
  const next: QueryFileView = { ...view, ...changes, source, problems };
  return {
    ...file,
    views: file.views.map((candidate) =>
      candidate === view ? next : candidate,
    ),
  };
}

export function serializeQueryFile(file: QueryFile): string {
  let source: Entries = Object.hasOwn(file.source, "filters")
    ? file.source
    : { filters: undefined, ...file.source };
  for (const added of ["formulas", "properties"]) {
    if (Object.hasOwn(source, added)) continue;
    const keys = Object.keys(source);
    const at = keys.includes("views") ? keys.indexOf("views") : keys.length;
    const before = source;
    source = Object.fromEntries([
      ...keys.slice(0, at).map((key) => [key, before[key]]),
      [added, undefined],
      ...keys.slice(at).map((key) => [key, before[key]]),
    ]);
  }
  const entries = merged(source, {
    filters: file.filters ?? file.source.filters,
    formulas: file.formulas ?? file.source.formulas,
    properties: file.properties ?? file.source.properties,
    views: file.views.map(writeView),
  });
  return stringify(entries, { lineWidth: 0 });
}

const FORMULA_PREFIX = `${FORMULA_SEGMENT}.`;

export function formulaProperty(name: string): string {
  return `${FORMULA_PREFIX}${name}`;
}

export function formulaName(property: string): string | null {
  return property.startsWith(FORMULA_PREFIX)
    ? property.slice(FORMULA_PREFIX.length)
    : null;
}

const VAULT_PREFIX = `${VAULT_SEGMENT}.`;

export function vaultName(property: string): string | null {
  return property.startsWith(VAULT_PREFIX)
    ? property.slice(VAULT_PREFIX.length)
    : null;
}

export function vaultProperty(name: string): string {
  return `${VAULT_PREFIX}${name}`;
}

export function isVaultProperty(property: string): boolean {
  return vaultName(property) !== null;
}

export function withFormula(
  file: QueryFile,
  name: string,
  text: string,
): QueryFile {
  return {
    ...file,
    formulas: nameDictionary([
      ...Object.entries(file.formulas ?? {}),
      [name, text],
    ]),
    problems: validKey(file.problems, "formulas"),
  };
}

function validKey(
  problems: readonly QueryFileProblem[],
  key: "formulas" | "properties",
): QueryFileProblem[] {
  return problems.filter(
    (problem) => !(problem.code === "invalid-value" && problem.key === key),
  );
}

function without<V>(
  dictionary: NameDictionary<V> | undefined,
  name: string,
): NameDictionary<V> {
  return nameDictionary(
    Object.entries(dictionary ?? {}).filter(([entry]) => entry !== name),
  );
}

function withoutKey(
  file: QueryFile,
  key: "formulas" | "properties",
): QueryFile {
  const { [key]: _dropped, ...source } = file.source;
  const { [key]: _none, ...rest } = file;
  return { ...rest, source };
}

function withProperties(
  file: QueryFile,
  properties: NameDictionary<unknown>,
): QueryFile {
  if (Object.keys(properties).length === 0)
    return withoutKey(file, "properties");
  return {
    ...file,
    properties,
    problems: validKey(file.problems, "properties"),
  };
}

export function removeFormula(file: QueryFile, name: string): QueryFile {
  const formulas = without(file.formulas, name);
  const property = formulaProperty(name);
  let next = file;
  for (const view of file.views)
    if (view.order?.includes(property))
      next = editView(next, view, {
        order: view.order.filter((entry) => entry !== property),
      });
  if (next.properties && Object.hasOwn(next.properties, property))
    next = withProperties(next, without(next.properties, property));
  if (Object.keys(formulas).length > 0) return { ...next, formulas };
  return withoutKey(next, "formulas");
}

export function displayName(
  file: QueryFile,
  property: string,
): string | undefined {
  const settings = file.properties?.[property];
  if (!Object.hasOwn(file.properties ?? {}, property) || !isMap(settings))
    return undefined;
  const { displayName: name } = settings;
  return typeof name === "string" && name !== "" ? name : undefined;
}

export function withDisplayName(
  file: QueryFile,
  property: string,
  name: string | undefined,
): QueryFile {
  if (name === undefined && displayName(file, property) === undefined)
    return file;
  const properties = new Map(Object.entries(file.properties ?? {}));
  const entry = properties.get(property);
  const current: Entries = isMap(entry) ? entry : {};
  const { displayName: _old, ...settings } = current;
  if (name !== undefined)
    properties.set(property, { ...current, displayName: name });
  else if (Object.keys(settings).length > 0) properties.set(property, settings);
  else properties.delete(property);
  return withProperties(file, nameDictionary(properties));
}

export interface NewQueryFileNames {
  readonly items: string;
  readonly annotations: string;
}

export function newQueryFileText(names: NewQueryFileNames): string {
  return serializeQueryFile({
    views: [
      {
        type: "table",
        name: names.items,
        from: "items",
        sort: [{ property: "dateModified", direction: "DESC" }],
        order: ["title", "creators", "date.year", LITERATURE_NOTE],
        limit: NEW_QUERY_FILE_LIMIT,
        problems: [],
        source: {},
      },
      {
        type: "annotations",
        name: names.annotations,
        from: "annotations",
        groupBy: { property: "item.indexedKey", direction: "ASC" },
        limit: NEW_QUERY_FILE_LIMIT,
        problems: [],
        source: {},
      },
    ],
    problems: [],
    source: {},
  });
}

export function allViewsDataset(file: QueryFile): QueryFileDataset {
  return file.views[0]?.from ?? "annotations";
}

export type FilterSection = "all" | "view";

export interface FilterLocation {
  readonly section: FilterSection;
  readonly path: readonly number[];
}

export interface ConditionIssue extends FilterLocation {
  readonly message: string;
  readonly fault?: PlacedFault;
}

export function withFilters(
  file: QueryFile,
  index: number | null,
  filters: FilterTree | undefined,
): QueryFile {
  const set = <T extends { readonly source: Readonly<Entries> }>(
    target: T,
  ): T => {
    const { filters: _dropped, ...source } = target.source;
    return {
      ...target,
      filters,
      source: filters === undefined ? source : target.source,
    };
  };
  if (index === null) return set(file);
  return {
    ...file,
    views: file.views.map((view, at) => (at === index ? set(view) : view)),
  };
}
