import type {
  QueryFileDataset,
  QueryFileSort,
  QueryFileView,
} from "#core/query-view/query-file.ts";
import type {
  QueryViewRequest,
  QueryViewRow,
} from "#worker/item-query/query-view.ts";

import type { LayoutRow } from "@zotlit/annotations/desktop/annot-view/layout.tsx";
import {
  compareScalars,
  projectedSortKey,
  valueText,
} from "@zotlit/item-query";
import type { ProjectionJson } from "@zotlit/item-query";

import type { PropertyOption } from "./properties.ts";
import { sortOptions } from "./properties.ts";
import { propertyIcon } from "./property-icon.ts";
import type { LayoutRows } from "./rows.ts";
import { layoutRows } from "./rows.ts";
import type { VaultPropertyType, VaultValue } from "./table-notes.ts";

import {
  isVaultProperty,
  vaultName,
  vaultProperty,
} from "#core/query-view/query-file.ts";

export const VAULT_SORT_CAP = 5000;

export function vaultSortRequest(request: QueryViewRequest): QueryViewRequest {
  const sortFields = (request.sort ?? []).map(({ field }) => field);
  return {
    ...request,
    fields: [...new Set([...(request.fields ?? []), ...sortFields])],
    limit: VAULT_SORT_CAP,
  };
}

function sortValue(value: VaultValue): string | number | boolean | null {
  if (!value.note || value.value === null || value.value === undefined)
    return null;
  const { value: v } = value;
  if (typeof v === "number" || typeof v === "boolean") return v;
  const text = typeof v === "string" ? v : valueText(v as ProjectionJson);
  return text === "" ? null : text;
}

export function sortByVault<R extends QueryViewRow>(
  rows: readonly R[],
  sort: readonly QueryFileSort[],
  read: (row: R, name: string) => VaultValue,
): R[] {
  const fields = sort.filter(({ property }) => !isVaultProperty(property));
  const ranks = new Map<R, number[]>();
  const firsts = fields.map(() => new Map<string, number>());
  rows.forEach((row, index) => {
    const prefix: unknown[] = [];
    ranks.set(
      row,
      fields.map(({ property }, i) => {
        prefix.push(projectedSortKey(property, row.values[property] ?? null));
        const key = JSON.stringify(prefix);
        if (!firsts[i]!.has(key)) firsts[i]!.set(key, index);
        return firsts[i]!.get(key)!;
      }),
    );
  });
  const keys = sort.map(({ property, direction }) => {
    const name = vaultName(property);
    if (name === null) {
      const i = fields.findIndex((field) => field.property === property);
      return (a: R, b: R) => ranks.get(a)![i]! - ranks.get(b)![i]!;
    }
    const values = new Map(
      rows.map((row) => [row, sortValue(read(row, name))]),
    );
    const sign = direction === "DESC" ? -1 : 1;
    return (a: R, b: R) => {
      const x = values.get(a)!;
      const y = values.get(b)!;
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return sign * compareScalars(x, y);
    };
  });
  const order = new Map(rows.map((row, index) => [row, index]));
  return [...rows].sort((a, b) => {
    for (const compare of keys) {
      const by = compare(a, b);
      if (by !== 0) return by;
    }
    return order.get(a)! - order.get(b)!;
  });
}

export function limitRows<R extends Pick<LayoutRow, "group">>(
  rows: readonly R[],
  limit: number | null,
): { rows: R[]; dropped: boolean } {
  if (limit === null) return { rows: [...rows], dropped: false };
  const counts = new Map<string, number>();
  const kept = rows.filter((row) => {
    const group = row.group?.key ?? "";
    const count = counts.get(group) ?? 0;
    counts.set(group, count + 1);
    return count < limit;
  });
  return { rows: kept, dropped: kept.length < rows.length };
}

export function vaultSortOptions(
  dataset: QueryFileDataset | undefined,
  names: readonly string[],
  {
    labelOf,
    typeOf,
  }: {
    labelOf: (path: string) => string;
    typeOf: (name: string) => VaultPropertyType;
  },
): PropertyOption[] {
  if (dataset !== "items") return [];
  return names.map((name) => {
    const path = vaultProperty(name);
    const type = typeOf(name);
    return {
      path,
      label: labelOf(path),
      kind: type === "number" || type === "date" ? type : "text",
      icon: propertyIcon("items", { path, kind: "vault" }, typeOf),
    };
  });
}

export function viewSortOptions(
  dataset: QueryFileDataset | undefined,
  names: readonly string[],
  labels: {
    labelOf: (path: string) => string;
    typeOf: (name: string) => VaultPropertyType;
  },
): PropertyOption[] {
  return [
    ...sortOptions(dataset, labels.labelOf),
    ...vaultSortOptions(dataset, names, labels),
  ];
}

export function vaultSortedLayout<R extends QueryViewRow>(
  rows: readonly R[],
  view: Pick<QueryFileView, "from" | "groupBy" | "groupOrder" | "limit">,
  {
    sort,
    read,
  }: {
    sort: readonly QueryFileSort[];
    read: (row: R, name: string) => VaultValue;
  },
): LayoutRows & { dropped: boolean } {
  const laid = layoutRows(sortByVault(rows, sort, read), view);
  const { rows: kept, dropped } = limitRows(laid.rows, view.limit ?? null);
  return {
    ...laid,
    rows: kept,
    count: new Set(kept.map((row) => row.annotationKey)).size,
    dropped,
  };
}
