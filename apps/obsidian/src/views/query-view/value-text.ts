import { valueText } from "@zotlit/item-query";
import { itemTypeLabel } from "@zotlit/notes/obsidian/profile-selection/describe.ts";

// How a Query View writes the value of a property as text. The Table, the
// List and Cards layouts, their search, and "Copy to clipboard" and "Export
// CSV…" all read it from here, so each shows and finds the same text. The
// text of a value comes from `@zotlit/item-query`, as the CLI export writes
// it; the label of a property comes from view-properties.
import type { QueryViewValue } from "@/services/item-query/query-view.ts";

/** One value as the text of a cell. */
export function cellText(
  property: string,
  value: QueryViewValue | undefined,
): string {
  if (property === "itemType" && typeof value === "string")
    return itemTypeLabel(value);
  return valueText(value);
}
