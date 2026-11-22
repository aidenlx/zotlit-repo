import { FIELD_ALIASES } from "@zotlit/zotero-types";
import type { ItemFields } from "@zotlit/zotero-types";

export const ITEM_BASE_FIELDS = [
  "publicationTitle",
  "publisher",
  "volume",
  "issue",
  "pages",
] as const;

export type ItemBaseFieldName = (typeof ITEM_BASE_FIELDS)[number];

export type ItemBaseFields = {
  readonly [K in ItemBaseFieldName]: string | null;
};

export const EMPTY_ITEM_BASE_FIELDS: ItemBaseFields = {
  publicationTitle: null,
  publisher: null,
  volume: null,
  issue: null,
  pages: null,
};

const VENUE_CHAIN = [
  "publicationTitle",
  "publisher",
] as const satisfies readonly ItemBaseFieldName[];

export function resolveVenue(baseFields: ItemBaseFields): string | null {
  for (const name of VENUE_CHAIN) {
    const value = baseFields[name];
    if (value) return value;
  }
  return null;
}

export function itemBaseFields(fields: ItemFields): ItemBaseFields {
  const tracked = new Set<string>(ITEM_BASE_FIELDS);
  const resolved: Record<ItemBaseFieldName, string | null> = {
    ...EMPTY_ITEM_BASE_FIELDS,
  };
  for (const [name, value] of Object.entries(fields)) {
    const baseName = FIELD_ALIASES[name] ?? name;
    if (!tracked.has(baseName) || value == null) continue;
    resolved[baseName as ItemBaseFieldName] = value;
  }
  return resolved;
}
