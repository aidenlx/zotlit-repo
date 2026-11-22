import type {
  QueryFile,
  QueryFileDirection,
  QueryFileSort,
  QueryFileView,
  QueryFileViewEdit,
} from "#core/query-view/query-file.ts";
import type { PropertyOption } from "#desktop/query-view/properties.ts";
import type { Menu } from "obsidian";

import { annotationColorsForName, annotationColorToName } from "@zotlit/db";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { MatchTree } from "@zotlit/templates/facade";

import { visibleText } from "#core/item-query/visible-text.ts";
import {
  serializeQueryFile,
  withFilters,
} from "#core/query-view/query-file.ts";
import {
  directionLabel,
  groupOptions,
  sortOptions,
} from "#desktop/query-view/properties.ts";

export const SIDEBAR_FILTER = "attachment == this.attachment";

export function sidebarQueryText(): string {
  return serializeQueryFile({
    filters: SIDEBAR_FILTER,
    views: [
      {
        type: "annotations",
        name: m.annot_view_name(),
        from: "annotations",
        problems: [],
        source: {},
      },
    ],
    problems: [],
    source: {},
  });
}

export function sidebarSortOptions(): PropertyOption[] {
  return sortOptions("annotations").filter(
    (option) => !option.path.includes("."),
  );
}

export function sidebarGroupOptions(): PropertyOption[] {
  return groupOptions("annotations").filter(
    (option) => option.path === "colorName" || option.path === "tags[]",
  );
}

const DEFAULT_SORT: QueryFileSort = { property: "sortIndex", direction: "ASC" };

export interface SidebarQueryMenuInput {
  view: QueryFileView | null;
  edit: (edit: QueryFileViewEdit) => void;
  openFilter: () => void;
  saveAs?: () => void;
}

export function addSidebarQueryMenu(
  menu: Menu,
  { view, edit, openFilter, saveAs }: SidebarQueryMenuInput,
): void {
  if (!view) return;
  const sorts = sidebarSortOptions();
  const sort = view.sort?.[0] ?? DEFAULT_SORT;
  const sortKind =
    sorts.find((option) => option.path === sort.property)?.kind ?? "text";
  menu.addItem((item) => {
    item.setTitle(m.annot_view_sort()).setIcon("arrow-up-down");
    const sub = item.setSubmenu();
    for (const option of sorts)
      sub.addItem((row) =>
        row
          .setTitle(option.label)
          .setChecked(option.path === sort.property)
          .onClick(() =>
            edit({
              sort: [{ property: option.path, direction: sort.direction }],
            }),
          ),
      );
    sub.addSeparator();
    for (const direction of ["ASC", "DESC"] as QueryFileDirection[])
      sub.addItem((row) =>
        row
          .setTitle(directionLabel(sortKind, direction))
          .setChecked(direction === sort.direction)
          .onClick(() =>
            edit({ sort: [{ property: sort.property, direction }] }),
          ),
      );
  });
  menu.addItem((item) => {
    item.setTitle(m.annot_view_group_by()).setIcon("layout-list");
    const sub = item.setSubmenu();
    sub.addItem((row) =>
      row
        .setTitle(m.annot_view_group_by_none())
        .setChecked(view.groupBy === undefined)
        .onClick(() => edit({ groupBy: undefined })),
    );
    for (const option of sidebarGroupOptions())
      sub.addItem((row) =>
        row
          .setTitle(option.label)
          .setChecked(view.groupBy?.property === option.path)
          .onClick(() =>
            edit({ groupBy: { property: option.path, direction: "ASC" } }),
          ),
      );
  });
  menu.addItem((item) =>
    item
      .setTitle(m.annot_view_filter())
      .setIcon("list-filter")
      .onClick(openFilter),
  );
  if (saveAs)
    menu.addItem((item) =>
      item
        .setTitle(m.annot_view_save_as_query_file())
        .setIcon("file-plus")
        .onClick(saveAs),
    );
}

export type SavedRecords = "this-item" | "note-item";

export interface SidebarFilterBar {
  readonly query: string;
  readonly colors: readonly string[];
  readonly tags: readonly string[];
}

export interface SaveQueryFileInput {
  readonly file: QueryFile;
  readonly view: QueryFileView;
  readonly filter: SidebarFilterBar;
  readonly records: SavedRecords;
  readonly itemKey: string | null;
  readonly attachmentKey: string | null;
}

function colorCondition(color: string): string {
  const name = annotationColorToName(color);
  if (name && annotationColorsForName(name).length === 1)
    return `colorName == ${JSON.stringify(name)}`;
  return `color.lower() == ${JSON.stringify(color.toLowerCase())}`;
}

function searchCondition(query: string): string {
  const needle = JSON.stringify(query.toLowerCase());
  return [
    `${visibleText("text")}.lower().contains(${needle})`,
    `${visibleText("comment")}.lower().contains(${needle})`,
    `!tags.filter(value.lower().contains(${needle})).isEmpty()`,
    `pageLabel.lower().contains(${needle})`,
  ].join(" || ");
}

function filterBarConditions({
  query,
  colors,
  tags,
}: SidebarFilterBar): MatchTree[] {
  const conditions: MatchTree[] = [];
  if (colors.length === 1) conditions.push(colorCondition(colors[0]!));
  else if (colors.length > 1)
    conditions.push({ or: colors.map(colorCondition) });
  if (tags.length > 0)
    conditions.push(
      `tags.containsAny(${tags.map((tag) => JSON.stringify(tag)).join(", ")})`,
    );
  if (query !== "") conditions.push(searchCondition(query));
  return conditions;
}

function allOf(
  tree: MatchTree | undefined,
  more: readonly MatchTree[],
): MatchTree | undefined {
  if (more.length === 0) return tree;
  if (tree === undefined)
    return more.length === 1 ? more[0] : { and: [...more] };
  const head = typeof tree !== "string" && "and" in tree ? tree.and : [tree];
  return { and: [...head, ...more] };
}

export function savedQueryFileText({
  file,
  view,
  filter,
  records,
  itemKey,
  attachmentKey,
}: SaveQueryFileInput): string {
  const scope =
    records === "note-item"
      ? "item == this.item"
      : attachmentKey !== null
        ? `attachment.indexedKey == ${JSON.stringify(attachmentKey)}`
        : `item.indexedKey == ${JSON.stringify(itemKey ?? "")}`;
  const one = withFilters(
    { ...file, views: [view] },
    0,
    allOf(view.filters, filterBarConditions(filter)),
  );
  return serializeQueryFile(withFilters(one, null, scope));
}
