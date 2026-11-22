export const CHILD_ITEM_TYPES = ["attachment", "note", "annotation"] as const;

export type ChildItemType = (typeof CHILD_ITEM_TYPES)[number];
