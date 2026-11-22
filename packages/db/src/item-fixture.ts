import type { ItemFields } from "@zotlit/zotero-types";

import { USER_LIBRARY_ID } from "./lib/constants.ts";
import { itemBaseFields, resolveVenue } from "./lib/zt-venue.ts";
import type { BaseItem, Item } from "./queries/items.ts";

export function makeItem(
  fields: { itemType: string } & Record<string, string | null>,
  base?: Partial<BaseItem>,
): Item {
  const baseFields = itemBaseFields(fields as ItemFields);
  return {
    itemID: 1,
    libraryID: USER_LIBRARY_ID,
    key: "KX67D9YM",
    indexedKey: "KX67D9YM",
    dateAdded: Temporal.Instant.from("2024-01-15T10:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-15T10:00:00Z"),
    creators: [
      {
        firstName: "David",
        lastName: "Hensher",
        creatorType: "author",
        fieldMode: 0,
      },
    ],
    primaryCreatorType: "author",
    customFields: new Map(),
    groupID: null,
    ...base,
    fields: fields as ItemFields,
    baseFields,
    venue: resolveVenue(baseFields),
  };
}
