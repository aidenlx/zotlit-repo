import type { QueryViewValue } from "#desktop/item-query/query-view.ts";

import { valueText } from "@zotlit/item-query";
import { itemTypeLabel } from "@zotlit/notes/obsidian/profile-selection/describe.ts";

export function cellText(
  property: string,
  value: QueryViewValue | undefined,
): string {
  if (property === "itemType" && typeof value === "string")
    return itemTypeLabel(value);
  return valueText(value);
}
