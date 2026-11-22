import { logLibrary } from "@zotlit/shared/logging";

import { defineToString } from "./to-string.ts";

const TAG_TYPE = {
  0: "manual",
  1: "auto",
} as const;

export type TagType = keyof typeof TAG_TYPE;
export type TagTypeName = (typeof TAG_TYPE)[TagType];

export interface Tag {
  tagID: number;
  name: string;
}

export interface ItemTag {
  itemID: number;
  tag: Tag;
  type: TagType;
}

export function tagTypeToName(type: number): TagTypeName | "unknown" {
  const name = (TAG_TYPE as Partial<Record<number, TagTypeName>>)[type];
  if (name) return name;

  logLibrary({
    level: "warn",
    category: ["zotlit", "db", "tags"],
    message: "Unknown tag type {type}",
    properties: { type },
  });
  return "unknown";
}

/**
 * A Tag in the template vocabulary. Coerces to `name` in string contexts (like a
 * collection coerces to its name), so `{{ zt.tags | join: ", " }}` renders tag
 * names directly. Zotero-internal IDs are dropped; `type` is the resolved name
 * rather than Zotero's raw int.
 */
export interface TemplateTag {
  /** Tag name as shown in Zotero. */
  name: string;
  /**
   * `"manual"` for a hand-added tag, `"auto"` for an automatic one (a
   * translator or plugin attached it while saving or importing); `"unknown"`
   * for a type id Zotero added after this mapping was written.
   */
  type: TagTypeName | "unknown";
  toString(): string;
}

export function toTemplateTag(tag: ItemTag): TemplateTag {
  return defineToString(
    { name: tag.tag.name, type: tagTypeToName(tag.type) },
    function () {
      return this.name;
    },
  );
}
