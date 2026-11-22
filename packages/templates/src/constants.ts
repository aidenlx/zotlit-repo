import * as v from "valibot";

export type TemplateLanguage = "liquid" | "eta";

export const ANNOTATION_HEADER = "--- zotlit:annotation ---";

export const MANAGED_BLOCK_TAG_NAMES: readonly [string, string] = [
  "managed",
  "endmanaged",
];

export const autoTrimSchema = v.union([
  v.literal(false),
  v.literal("nl"),
  v.literal("slurp"),
]);

export const DEFAULT_AUTO_TRIM: Readonly<
  Record<"leading" | "trailing", AutoTrim>
> = {
  leading: false,
  trailing: false,
};

export type AutoTrim = v.InferOutput<typeof autoTrimSchema>;

export const frontmatterMergeStrategySchema = v.picklist([
  "replace",
  "append",
  "keep",
]);
export type FrontmatterMergeStrategy = v.InferOutput<
  typeof frontmatterMergeStrategySchema
>;

export const RESERVED_FRONTMATTER_KEYS: ReadonlySet<string> = new Set([
  "zotero-key",
  "zotlit-profile",
  "zotero-note-key",
  "zotero-lastmod",
  "zotlit-csl",
]);

export const frontmatterLanguageSchema = v.picklist(["liquid", "javascript"]);
export type FrontmatterLanguage = v.InferOutput<
  typeof frontmatterLanguageSchema
>;

export const frontmatterFieldSchema = v.object({
  key: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  expr: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  merge: frontmatterMergeStrategySchema,
  language: frontmatterLanguageSchema,
});
export type FrontmatterField = v.InferOutput<typeof frontmatterFieldSchema>;
