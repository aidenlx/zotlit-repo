import type {
  QueryFileDataset,
  QueryFileGroupValue,
  QueryFileView,
} from "#core/query-view/query-file.ts";
import type { QueryViewRow } from "#desktop/item-query/query-view.ts";

import type { LayoutRow } from "@zotlit/annotations/desktop/annot-view/layout.tsx";
import { compareStrings } from "@zotlit/item-query";

import { datasetSpec, grouping } from "./datasets.ts";

export function groupPaths(
  dataset: QueryFileDataset | undefined,
): readonly string[] {
  return datasetSpec(dataset).group.map(({ path }) => path);
}

export interface LayoutGroup {
  value: QueryFileGroupValue;
  label: string;
  count: number;
  shown: boolean;
}

export interface LayoutRows {
  rows: LayoutRow[];
  groups: LayoutGroup[];
  count: number;
}

export function layoutRows(
  rows: readonly QueryViewRow[],
  {
    from,
    groupBy,
    groupOrder,
  }: Pick<QueryFileView, "from" | "groupBy" | "groupOrder">,
): LayoutRows {
  const base = (row: QueryViewRow): LayoutRow => ({
    annotationKey: row.indexedKey,
    attachmentKey: row.attachmentIndexedKey ?? row.indexedKey,
  });
  const by = groupBy && grouping(from, groupBy.property);
  if (!groupBy || !by)
    return { rows: rows.map(base), groups: [], count: rows.length };
  const groups = new Map<
    QueryFileGroupValue,
    { label: string; rows: LayoutRow[] }
  >();
  for (const row of rows)
    for (const { value, label } of by.place(row)) {
      const group = groups.get(value) ?? { label, rows: [] };
      group.rows.push({
        ...base(row),
        group: { key: value ?? "", label },
      });
      groups.set(value, group);
    }
  const sign = groupBy.direction === "DESC" ? -1 : 1;
  let order: QueryFileGroupValue[] = [...groups.keys()]
    .filter((value) => value !== null)
    .sort(
      (a, b) =>
        sign *
        (compareStrings(groups.get(a)!.label, groups.get(b)!.label) ||
          compareStrings(a, b)),
    );
  if (groups.has(null)) order.push(null);
  let hidden: QueryFileGroupValue[] = [];
  if (groupOrder) {
    hidden = order.filter((value) => !groupOrder.includes(value));
    order = groupOrder.filter((value) => groups.has(value));
  }
  const shownRows = order.flatMap((value) => groups.get(value)!.rows);
  const summary = (value: QueryFileGroupValue, shown: boolean) => ({
    value,
    label: groups.get(value)!.label,
    count: groups.get(value)!.rows.length,
    shown,
  });
  return {
    rows: shownRows,
    groups: [
      ...order.map((value) => summary(value, true)),
      ...hidden.map((value) => summary(value, false)),
    ],
    count: new Set(shownRows.map((row) => row.annotationKey)).size,
  };
}
