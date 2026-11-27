import type { ItemFields } from "@zotlit/zotero-types";

export const CHILD_ITEM_TYPES = ["attachment", "note", "annotation"] as const;

export type ChildItemType = (typeof CHILD_ITEM_TYPES)[number];

export type ChildItemFields = Extract<
  ItemFields,
  { readonly itemType: ChildItemType }
>;

export function isChildItemFields(
  fields: ItemFields,
): fields is ChildItemFields {
  return CHILD_ITEM_TYPES.some((itemType) => itemType === fields.itemType);
}
