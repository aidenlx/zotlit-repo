import type { QueryFileSort } from "#core/query-view/query-file.ts";

import type { PropertyKind } from "./view-properties.ts";
import type { QueryViewCapabilities } from "./view.tsx";

export type ColumnMenuAction =
  | "hide"
  | "group"
  | "move-left"
  | "move-right"
  | "reset-width"
  | "sort-asc"
  | "sort-desc"
  | "clear-sort"
  | "edit-property"
  | "edit-formula";

export interface ColumnMenuEntry {
  readonly action: ColumnMenuAction;
  readonly disabled?: boolean;
  readonly checked?: boolean;
}

export interface ColumnMenuInput {
  readonly path: string;
  readonly kind: PropertyKind;
  readonly at: number;
  readonly count: number;
  readonly rtl: boolean;
  readonly sized: boolean;
  readonly can: Pick<
    QueryViewCapabilities,
    "properties" | "group" | "columnWidth" | "propertyPages"
  >;
  readonly sortable: boolean;
  readonly sort: readonly QueryFileSort[];
  readonly groupBy: QueryFileSort | undefined;
  readonly grouping: string | null;
}

export function columnMenuEntries(input: ColumnMenuInput): ColumnMenuEntry[][] {
  const { can, at, count, rtl } = input;
  const atStart = at <= 0;
  const atEnd = at < 0 || at >= count - 1;
  const sorted = input.sort.find((sort) => sort.property === input.path);
  const groups: (ColumnMenuEntry | false)[][] = [
    [
      can.properties && { action: "hide" },
      can.group &&
        input.grouping !== null && {
          action: "group",
          checked: input.groupBy?.property === input.grouping,
        },
    ],
    [
      { action: "move-left", disabled: rtl ? atEnd : atStart },
      { action: "move-right", disabled: rtl ? atStart : atEnd },
      can.columnWidth && { action: "reset-width", disabled: !input.sized },
    ],
    [
      {
        action: "sort-asc",
        disabled: !input.sortable,
        checked: sorted?.direction === "ASC",
      },
      {
        action: "sort-desc",
        disabled: !input.sortable,
        checked: sorted?.direction === "DESC",
      },
      sorted !== undefined && { action: "clear-sort" },
    ],
    [
      can.propertyPages && {
        action: input.kind === "formula" ? "edit-formula" : "edit-property",
      },
    ],
  ];
  return groups
    .map((group) => group.filter((entry) => entry !== false))
    .filter((group) => group.length > 0);
}
