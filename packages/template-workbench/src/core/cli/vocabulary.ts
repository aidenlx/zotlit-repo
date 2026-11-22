import type { CitationExampleId, PartialContext } from "#core/render/index.ts";

import { CITATION_VARIANTS, TEMPLATE_SLOT_ROOTS } from "@zotlit/db";
import type { CitationVariant, TemplateSlot } from "@zotlit/db";
import type {
  FrontmatterLanguage,
  FrontmatterMergeStrategy,
} from "@zotlit/templates/constants";

import { CITATION_EXAMPLE_IDS, PARTIAL_CONTEXTS } from "#core/render/index.ts";

export const TEMPLATE_SLOT_NAMES = Object.keys(
  TEMPLATE_SLOT_ROOTS,
) as readonly TemplateSlot[];

export const CITATION_TEMPLATE = "citation";

export const PARTIAL_TEMPLATE_PREFIX = "partial:";

export function isPartialTemplate(
  template: string,
): template is `partial:${string}` {
  return template.startsWith(PARTIAL_TEMPLATE_PREFIX);
}

export function partialTemplateName(template: `partial:${string}`): string;
export function partialTemplateName(template: string): string | null;
export function partialTemplateName(template: string): string | null {
  return isPartialTemplate(template)
    ? template.slice(PARTIAL_TEMPLATE_PREFIX.length)
    : null;
}

export type RenderTemplate =
  | TemplateSlot
  | typeof CITATION_TEMPLATE
  | `partial:${string}`;

export const RENDER_TEMPLATE_NAMES: readonly string[] = [
  ...TEMPLATE_SLOT_NAMES,
  CITATION_TEMPLATE,
  `${PARTIAL_TEMPLATE_PREFIX}<name>`,
];

export const PARTIAL_CONTEXT_NAMES: readonly PartialContext[] =
  PARTIAL_CONTEXTS;

export const CITATION_VARIANT_NAMES: readonly CitationVariant[] =
  CITATION_VARIANTS;

export const CITATION_EXAMPLE_NAMES: readonly CitationExampleId[] =
  CITATION_EXAMPLE_IDS;

export const FRONTMATTER_LANGUAGE_NAMES = [
  "liquid",
  "javascript",
] as const satisfies readonly FrontmatterLanguage[];

export const FRONTMATTER_MERGE_NAMES = [
  "replace",
  "append",
  "keep",
] as const satisfies readonly FrontmatterMergeStrategy[];

export function quotedList(names: readonly string[]): string {
  const quoted = names.map((name) => `'${name}'`);
  const last = quoted.at(-1) ?? "";
  return quoted.length > 1
    ? `${quoted.slice(0, -1).join(", ")}, or ${last}`
    : last;
}

export function choices(names: readonly string[]): string {
  return `<${names.join("|")}>`;
}
