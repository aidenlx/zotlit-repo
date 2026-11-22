import { itemBaseFields, resolveVenue } from "@zotlit/db";
import type { BaseItem, Creator, IndexedItem, Item } from "@zotlit/db";
import type { ItemFields, JournalArticleFields } from "@zotlit/zotero-types";

import type { MemoryItemRow } from "./memory-item-source.ts";

export {
  makeMemoryItemSource,
  type MemoryItemRow,
  type MemoryItemSource,
  type MemoryItemSourceReads,
} from "./memory-item-source.ts";
export {
  makeMemorySegmenterBinaryReader,
  type MemorySegmenterBinaryReader,
} from "./memory-segmenter-binary-reader.ts";

type FieldsOf<TType extends ItemFields["itemType"]> = Omit<
  Extract<ItemFields, { itemType: TType }>,
  "itemType"
>;

export interface ItemFixtureOptions {
  key: string;
  itemID?: number;
  libraryID?: number;
  itemType?: ItemFields["itemType"];
  title?: string | null;
  citationKey?: string | null;
  date?: string | null;
  dateModified?: string;
  lastActivity?: number | null;
  creators?: Creator[];
  primaryCreatorType?: string | null;
  language?: string | null;
  publicationTitle?: string | null;
  shortTitle?: string | null;
  court?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
}

export type TypedItemFixtureOptions<TType extends ItemFields["itemType"]> =
  ItemFixtureOptions & {
    itemType: TType;
    fields?: FieldsOf<TType>;
  };

export function makeIndexedItem(options: ItemFixtureOptions): IndexedItem {
  const creators = options.creators ?? [];
  return {
    itemID: options.itemID ?? options.key.charCodeAt(0),
    libraryID: options.libraryID ?? 1,
    key: options.key,
    indexedKey: options.key,
    dateModified: Temporal.Instant.from(
      options.dateModified ?? "1970-01-01T00:00:00Z",
    ),
    lastActivity: options.lastActivity ?? null,
    itemType: options.itemType ?? "book",
    primaryCreator: creators[0] ?? null,
    creators,
    language: options.language ?? null,
    title: options.title ?? null,
    publicationTitle: options.publicationTitle ?? null,
    shortTitle: options.shortTitle ?? null,
    court: options.court ?? null,
    citationKey: options.citationKey ?? null,
    date: options.date ?? null,
  };
}

export function makeMemoryItemRow(options: ItemFixtureOptions): MemoryItemRow {
  return { indexed: makeIndexedItem(options), item: makeItem(options) };
}

export function makeItem(options: ItemFixtureOptions): Item;
export function makeItem<TType extends ItemFields["itemType"]>(
  options: TypedItemFixtureOptions<TType>,
): Item;
export function makeItem(
  options: ItemFixtureOptions & {
    fields?: Readonly<Record<string, string | null>>;
  },
): Item {
  const itemType = options.itemType ?? "book";
  const base: BaseItem = {
    itemID: options.itemID ?? options.key.charCodeAt(0),
    libraryID: options.libraryID ?? 1,
    key: options.key,
    indexedKey: options.key,
    dateAdded: Temporal.Instant.from(
      options.dateModified ?? "1970-01-01T00:00:00Z",
    ),
    dateModified: Temporal.Instant.from(
      options.dateModified ?? "1970-01-01T00:00:00Z",
    ),
    creators: options.creators ?? [],
    primaryCreatorType: options.primaryCreatorType ?? null,
    customFields: new Map<string, string | null>(),
  };
  const common = {
    title: options.title ?? null,
    citationKey: options.citationKey ?? null,
    date: options.date ?? null,
    language: options.language ?? null,
  };
  const fields = (
    itemType === "journalArticle"
      ? ({
          itemType: "journalArticle",
          ...common,
          publicationTitle: options.publicationTitle ?? null,
          volume: options.volume ?? null,
          issue: options.issue ?? null,
          pages: options.pages ?? null,
          ...options.fields,
        } satisfies JournalArticleFields)
      : { itemType, ...common, ...options.fields }
  ) as ItemFields;
  const baseFields = itemBaseFields(fields);
  return {
    ...base,
    groupID: null,
    fields,
    baseFields,
    venue: resolveVenue(baseFields),
  };
}

export function makeCreator(firstName: string, lastName: string): Creator {
  return {
    firstName,
    lastName,
    creatorType: "author",
    fieldMode: 0,
  };
}
