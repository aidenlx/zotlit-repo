import type {
  QueryFile,
  QueryFileDataset,
  QueryFileSort,
  QueryFileView,
} from "#core/query-view/query-file.ts";
import { useMemo } from "react";

import { cellProperties, fieldSearchTerms } from "@zotlit/item-query";
import { NON_VAULT_PROPERTY_KEYS } from "@zotlit/plugin-kernel/constants.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { runtime } from "@zotlit/plugin-messages/runtime.ts";
import { FIELD_LABELS } from "@zotlit/zotero-types/field-labels";

import { DATASETS } from "./datasets.ts";
import { useQueryViewState } from "./model.ts";
import { formulaIssuesOf } from "./results.ts";
import type { FormulaIssue } from "./results.ts";
import { groupPaths } from "./rows.ts";
import type { QueryView } from "./view.tsx";

import {
  LITERATURE_NOTE,
  QUERY_FILE_DATASETS,
  displayName,
  formulaName,
  formulaProperty,
  isVaultProperty,
  vaultName,
  vaultProperty,
} from "#core/query-view/query-file.ts";

export function isVaultPropertyName(name: string): boolean {
  return name !== "" && !NON_VAULT_PROPERTY_KEYS.has(name);
}

export type PropertyKind = "field" | "formula" | "vault";

type PropertySettings = Pick<
  QueryFileView,
  "from" | "order" | "sort" | "groupBy"
> &
  Partial<Pick<QueryFileView, "type">>;

function classify(path: string): {
  kind: PropertyKind;
  formula: string | null;
} {
  if (isVaultProperty(path)) return { kind: "vault", formula: null };
  const formula = formulaName(path);
  return { kind: formula === null ? "field" : "formula", formula };
}

export interface PropertyEntry {
  readonly path: string;
  readonly label: string;
  readonly displayName: string | null;
  readonly searchTerms: readonly string[];
  readonly kind: PropertyKind;
  readonly nested: boolean;
  readonly formula: string | null;
  readonly issue: string | null;
  readonly fits: boolean;
  readonly place: number | null;
}

export interface UnusedSettings {
  readonly sort: readonly string[];
  readonly groupBy: string | null;
  readonly order: readonly string[];
}

export interface ViewProperties {
  readonly visible: readonly PropertyEntry[];
  readonly queried: readonly PropertyEntry[];
  readonly entries: readonly PropertyEntry[];
  readonly unused: UnusedSettings;
  entry(path: string): PropertyEntry;
  kept(path: string): PropertyEntry | null;
  orderOf(next: readonly string[]): string[];
  withShown(path: string, shown: boolean): string[];
}

export interface KnownProperties {
  readonly formulaIssues?: Readonly<Record<string, FormulaIssue>>;
  readonly vaultNames?: readonly string[];
}

export function viewProperties(
  file: QueryFile | null,
  view: PropertySettings,
  { formulaIssues = {}, vaultNames = [] }: KnownProperties = {},
): ViewProperties {
  const dataset = view.from ?? "annotations";
  const properties = datasetProperties(dataset);
  const showsNote = view.type === "table" && dataset === "items";
  const fits = (path: string) =>
    path === LITERATURE_NOTE
      ? showsNote
      : isVaultProperty(path)
        ? dataset === "items"
        : fitsDataset(path, dataset);
  const defaults = [
    ...DATASETS[dataset].engine.defaultFields.filter((field) =>
      properties.includes(field),
    ),
    ...(showsNote ? [LITERATURE_NOTE] : []),
  ];
  const fitting = [...new Set((view.order ?? []).filter(fits))];
  const shown =
    view.order === undefined
      ? defaults
      : view.order.length === 0
        ? []
        : fitting.length > 0
          ? fitting
          : defaults;
  const known = new Map<string, PropertyEntry>();
  const entry = (path: string): PropertyEntry => {
    let found = known.get(path);
    if (!found) {
      const { kind, formula } = classify(path);
      const place = shown.indexOf(path);
      const named = (file && displayName(file, path)) ?? null;
      found = {
        path,
        label: named ?? fieldLabel(path),
        displayName: named,
        searchTerms:
          kind === "field"
            ? fieldSearchTerms(view.from ?? "annotations", path)
            : [],
        kind,
        nested: kind === "field" && path.includes("."),
        formula,
        issue:
          formula !== null && Object.hasOwn(formulaIssues, formula)
            ? formulaIssues[formula]!.message
            : null,
        fits: fits(path),
        place: place === -1 ? null : place,
      };
      known.set(path, found);
    }
    return found;
  };
  const paths = new Set([
    ...shown,
    ...Object.keys(file?.formulas ?? {}).map(formulaProperty),
    ...(showsNote ? [LITERATURE_NOTE] : []),
    ...(dataset === "items"
      ? vaultNames.map((name) => vaultProperty(name))
      : []),
    ...datasetProperties(dataset),
  ]);
  const unused = unusedSettings(view);
  const keptForTable = (view.order ?? []).filter(
    (property) => isVaultProperty(property) && !fits(property),
  );
  const visible = shown.map(entry);
  const entries = [...paths].map(entry);
  const orderOf = (next: readonly string[]) =>
    next.length === 0
      ? []
      : [
          ...next,
          ...[...unused.order, ...keptForTable].filter(
            (property) => !next.includes(property),
          ),
        ];
  return {
    visible,
    queried: visible.filter(({ kind }) => kind !== "vault"),
    entries,
    unused,
    entry,
    kept: (path) =>
      paths.has(path) || classify(path).kind !== "formula" ? entry(path) : null,
    orderOf,
    withShown: (path, show) =>
      orderOf(
        !show
          ? shown.filter((property) => property !== path)
          : shown.includes(path)
            ? shown
            : [...shown, path],
      ),
  };
}

export function useViewProperties(
  view: QueryView,
  vaultNames?: readonly string[],
): ViewProperties | null {
  const file = useQueryViewState(view, (s) => s.file);
  const shown = useQueryViewState(view, (s) => s.view);
  const faults = useQueryViewState(view, formulaIssuesOf);
  return useMemo(
    () =>
      shown
        ? viewProperties(file, shown, { formulaIssues: faults, vaultNames })
        : null,
    [file, shown, faults, vaultNames],
  );
}

const cache = new Map<QueryFileDataset, readonly string[]>();

function datasetProperties(dataset: QueryFileDataset): readonly string[] {
  let properties = cache.get(dataset);
  if (!properties) {
    properties = cellProperties(DATASETS[dataset].engine).filter(
      (path) => path !== "position" && !path.startsWith("position."),
    );
    cache.set(dataset, properties);
  }
  return properties;
}

function fitsDataset(property: string, dataset: QueryFileDataset): boolean {
  return (
    datasetProperties(dataset).includes(property) ||
    !QUERY_FILE_DATASETS.some((other) =>
      datasetProperties(other).includes(property),
    )
  );
}

export function unusedSettings(
  view: Pick<QueryFileView, "from" | "sort" | "groupBy" | "order">,
): UnusedSettings {
  const dataset = view.from ?? "annotations";
  const ofAnotherDataset = (has: (other: QueryFileDataset) => boolean) =>
    !has(dataset) && QUERY_FILE_DATASETS.some((other) => has(other));
  return {
    sort: (view.sort ?? [])
      .map(({ property }) => property)
      .filter(
        (property) =>
          !DATASETS[dataset].engine.sortableFields.includes(property) &&
          QUERY_FILE_DATASETS.some(
            (other) =>
              DATASETS[other].engine.definition(property) !== undefined ||
              DATASETS[other].engine.sortableFields.includes(property),
          ),
      ),
    groupBy:
      view.groupBy &&
      ofAnotherDataset((other) =>
        groupPaths(other).includes(view.groupBy!.property),
      )
        ? view.groupBy.property
        : null,
    order: (view.order ?? []).filter(
      (property) =>
        !isVaultProperty(property) && !fitsDataset(property, dataset),
    ),
  };
}

export function usedGroupBy(
  view: Pick<QueryFileView, "from" | "sort" | "groupBy" | "order">,
): QueryFileSort | undefined {
  return unusedSettings(view).groupBy === null ? view.groupBy : undefined;
}

export function fieldLabel(property: string): string {
  if (property === LITERATURE_NOTE) return m.query_view_table_literature_note();
  const label = labelOf(property);
  if (label !== undefined) return label;
  const name = vaultName(property);
  return name === null ? property : m.query_view_vault_property_label({ name });
}

function labelOf(property: string): string | undefined {
  const locale = runtime.getLocale() === "zh-CN" ? "zh-CN" : "en-US";
  const label =
    FIELD_LABELS[locale][property] ??
    OWN_LABELS[property]?.() ??
    datasetLabel(property);
  if (label) return label;
  for (const [prefix, parent, of] of PARENTS) {
    if (!property.startsWith(prefix)) continue;
    const field = labelOf(property.slice(prefix.length));
    if (field === undefined) return undefined;
    const rest = field.startsWith(parent())
      ? field.slice(parent().length)
      : null;
    return of({
      property: inSentence(
        rest !== null && !/^[a-z]/i.test(rest) ? rest.trim() : field,
      ),
    });
  }
  return undefined;
}

const OWN_LABELS: Readonly<Record<string, () => string>> = {
  creators: m.query_view_property_creators,
  "date.year": m.query_view_property_year,
};

const PARENTS = [
  ["item.", m.query_view_property_item, m.query_view_property_of_item],
  [
    "attachment.",
    m.query_view_property_attachment,
    m.query_view_property_of_attachment,
  ],
] as const;

let datasetLabels: ReadonlyMap<string, () => string> | null = null;

function datasetLabel(property: string): string | undefined {
  datasetLabels ??= new Map(
    Object.values(DATASETS).flatMap((spec) => [
      ...spec.sort.map(([path, label]) => [path, label] as const),
      ...spec.group.map(
        ({ path, label }) => [path.replace(/\[\]$/, ""), label] as const,
      ),
    ]),
  );
  return datasetLabels.get(property)?.();
}

function inSentence(label: string): string {
  return label
    .split(" ")
    .map((word) => (/^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase()))
    .join(" ");
}
