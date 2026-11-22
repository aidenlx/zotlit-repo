import type {
  QueryFileDataset,
  QueryFileDirection,
} from "#core/query-view/query-file.ts";

import { fieldSearchTerms } from "@zotlit/item-query";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { datasetSpec } from "./datasets.ts";
import { propertyIcon } from "./property-icon.ts";

export type PropertyKind = "text" | "date" | "number";

export interface PropertyOption {
  readonly path: string;
  readonly label: string;
  readonly kind: PropertyKind;
  readonly icon: string;
  readonly searchTerms?: readonly string[];
}

export type OptionLabel = ((path: string) => string) | undefined;

export function sortOptions(
  dataset: QueryFileDataset | undefined,
  labelOf?: OptionLabel,
): PropertyOption[] {
  const { engine, sort } = datasetSpec(dataset);
  const sortable = new Set(engine.sortableFields);
  return sort
    .filter(([path]) => sortable.has(path))
    .map(([path, label, kind]) => ({
      path,
      label: labelOf?.(path) ?? label(),
      kind,
      icon: propertyIcon(dataset ?? "annotations", { path, kind: "field" }),
      searchTerms: fieldSearchTerms(dataset ?? "annotations", path),
    }));
}

export function groupOptions(
  dataset: QueryFileDataset | undefined,
  labelOf?: OptionLabel,
): PropertyOption[] {
  return datasetSpec(dataset).group.map(({ path, label }) => {
    const field = path.replace(/\[\]$/, "");
    return {
      path,
      label: labelOf?.(field) ?? label(),
      kind: "text",
      icon: propertyIcon(dataset ?? "annotations", {
        path: field,
        kind: "field",
      }),
      searchTerms: fieldSearchTerms(dataset ?? "annotations", field),
    };
  });
}

export function directionLabel(
  kind: PropertyKind,
  direction: QueryFileDirection,
): string {
  const ascending = direction === "ASC";
  switch (kind) {
    case "date":
      return ascending
        ? m.query_view_sort_old_new()
        : m.query_view_sort_new_old();
    case "number":
      return ascending ? m.query_view_sort_01() : m.query_view_sort_10();
    case "text":
      return ascending ? m.query_view_sort_az() : m.query_view_sort_za();
    default:
      kind satisfies never;
      return direction;
  }
}
