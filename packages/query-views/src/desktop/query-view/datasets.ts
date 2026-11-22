import type {
  QueryFileDataset,
  QueryFileGroupValue,
} from "#core/query-view/query-file.ts";
import type { QueryViewRow } from "#desktop/item-query/query-view.ts";

import { ANNOTATIONS, ATTACHMENTS, ITEMS } from "@zotlit/item-query";
import type { QueryDataset } from "@zotlit/item-query";
import { itemTypeLabel } from "@zotlit/notes/obsidian/profile-selection/describe.ts";
import { annotationColorLabel } from "@zotlit/plugin-kernel/annotation-colors.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { PropertyKind } from "./properties.ts";

export type SortCandidate = readonly [
  path: string,
  label: () => string,
  kind: PropertyKind,
];

export interface Placement {
  readonly value: QueryFileGroupValue;
  readonly label: string;
}

export interface Grouping {
  readonly path: string;
  readonly label: () => string;
  readonly fields: readonly string[];
  place(row: QueryViewRow): Placement[];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function texts(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((entry: unknown) =>
          typeof entry === "object" && entry !== null && "name" in entry
            ? text(entry.name)
            : text(entry),
        )
        .filter((entry) => entry !== null)
    : [];
}

function each(values: string[]): Placement[] {
  return values.length > 0
    ? values.map((value) => ({ value, label: value }))
    : [{ value: null, label: m.query_view_group_none() }];
}

function byList(path: string, label: () => string, field: string): Grouping {
  return {
    path,
    label,
    fields: [field],
    place: (row) => each(texts(row.values[field])),
  };
}

function attachmentPlacement(row: QueryViewRow, title: string): Placement {
  const key = row.attachmentIndexedKey ?? row.indexedKey;
  return { value: key, label: text(row.values[title]) ?? key };
}

function byItem(attachmentTitle: string): Grouping {
  return {
    path: "item.indexedKey",
    label: m.query_view_property_item,
    fields: ["item.title", attachmentTitle],
    place: (row) =>
      row.itemIndexedKey === undefined
        ? [attachmentPlacement(row, attachmentTitle)]
        : [
            {
              value: row.itemIndexedKey,
              label: text(row.values["item.title"]) ?? row.itemIndexedKey,
            },
          ],
  };
}

const BY_ATTACHMENT: Grouping = {
  path: "attachment.indexedKey",
  label: m.query_view_property_attachment,
  fields: ["attachment.title"],
  place: (row) => [attachmentPlacement(row, "attachment.title")],
};

const BY_COLOR: Grouping = {
  path: "colorName",
  label: m.query_view_property_color,
  fields: ["color", "colorName"],
  place: (row) => {
    const hex = text(row.values.color)?.toLowerCase() ?? null;
    const value = text(row.values.colorName) ?? hex;
    if (value === null) return each([]);
    return [{ value, label: hex ? annotationColorLabel(hex) : value }];
  },
};

const BY_ITEM_TYPE: Grouping = {
  path: "itemType",
  label: m.query_view_property_item_type,
  fields: ["itemType"],
  place: (row) => {
    const itemType = text(row.values.itemType);
    return itemType === null
      ? each([])
      : [{ value: itemType, label: itemTypeLabel(itemType) }];
  },
};

const BY_TAG = byList("tags[]", m.query_view_property_tag, "tags");
const BY_ITEM_COLLECTION = byList(
  "item.collections[]",
  m.query_view_property_collection,
  "item.collections",
);

export interface DatasetSpec {
  readonly engine: QueryDataset;
  readonly name: () => string;
  readonly empty: () => string;
  readonly search: () => string;
  readonly sort: readonly SortCandidate[];
  readonly group: readonly Grouping[];
}

export const DATASETS: Readonly<Record<QueryFileDataset, DatasetSpec>> = {
  annotations: {
    engine: ANNOTATIONS,
    name: m.query_view_dataset_annotations,
    empty: m.query_view_no_results_annotations,
    search: m.query_view_search_annotations,
    sort: [
      ["sortIndex", m.query_view_property_position, "number"],
      ["pageIndex", m.query_view_property_page, "number"],
      ["dateAdded", m.query_view_property_date_added, "date"],
      ["dateModified", m.query_view_property_date_modified, "date"],
      ["color", m.query_view_property_color, "text"],
      ["type", m.query_view_property_type, "text"],
      ["item.title", m.query_view_property_item_title, "text"],
      ["item.firstAuthor", m.query_view_property_first_author, "text"],
      ["item.date", m.query_view_property_item_date, "date"],
      ["item.dateModified", m.query_view_property_item_date_modified, "date"],
      ["attachment.title", m.query_view_property_attachment_title, "text"],
      [
        "attachment.dateAdded",
        m.query_view_property_attachment_date_added,
        "date",
      ],
    ],
    group: [
      byItem("attachment.title"),
      BY_ATTACHMENT,
      BY_COLOR,
      BY_TAG,
      BY_ITEM_COLLECTION,
    ],
  },
  attachments: {
    engine: ATTACHMENTS,
    name: m.query_view_dataset_attachments,
    empty: m.query_view_no_results_attachments,
    search: m.query_view_search_attachments,
    sort: [
      ["title", m.query_view_property_title, "text"],
      ["dateAdded", m.query_view_property_date_added, "date"],
      ["dateModified", m.query_view_property_date_modified, "date"],
      ["item.title", m.query_view_property_item_title, "text"],
      ["item.firstAuthor", m.query_view_property_first_author, "text"],
      ["item.date", m.query_view_property_item_date, "date"],
    ],
    group: [byItem("title"), BY_TAG, BY_ITEM_COLLECTION],
  },
  items: {
    engine: ITEMS,
    name: m.query_view_dataset_items,
    empty: m.query_view_no_results_items,
    search: m.query_view_search_items,
    sort: [
      ["title", m.query_view_property_title, "text"],
      ["firstAuthor", m.query_view_property_first_author, "text"],
      ["date", m.query_view_property_date, "date"],
      ["dateAdded", m.query_view_property_date_added, "date"],
      ["dateModified", m.query_view_property_date_modified, "date"],
      ["itemType", m.query_view_property_item_type, "text"],
    ],
    group: [
      BY_ITEM_TYPE,
      BY_TAG,
      byList("collections[]", m.query_view_property_collection, "collections"),
    ],
  },
};

export function datasetSpec(
  dataset: QueryFileDataset | undefined,
): DatasetSpec {
  return DATASETS[dataset ?? "annotations"];
}

export function grouping(
  dataset: QueryFileDataset | undefined,
  path: string,
): Grouping | undefined {
  return datasetSpec(dataset).group.find((entry) => entry.path === path);
}
