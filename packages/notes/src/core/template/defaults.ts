import { regex } from "arkregex";

import { basename, dirname, join } from "@zotlit/plugin-kernel/vault-path.ts";
import citation from "@zotlit/templates/defaults/citation.liquid?raw";
import content from "@zotlit/templates/defaults/content.liquid?raw";
import filename from "@zotlit/templates/defaults/filename.liquid?raw";
import note from "@zotlit/templates/defaults/note.liquid?raw";
import { DEFAULT_ANNOTATION_LIQUID as annotation } from "@zotlit/templates/facade";
import type { TemplateLanguage } from "@zotlit/templates/facade";
import type { FrontmatterField } from "@zotlit/templates/frontmatter";

import { normalizeVaultPath } from "./path.ts";

function freezeAll<const T extends readonly object[]>(items: T): Readonly<T> {
  items.forEach(Object.freeze);
  return Object.freeze(items);
}

export const DEFAULT_FRONTMATTER_FIELDS = freezeAll([
  { key: "title", expr: "zt.title", merge: "replace", language: "liquid" },
  {
    key: "related",
    expr: "zt.relatedItems | note_links",
    merge: "replace",
    language: "liquid",
  },
  {
    key: "collections",
    expr: "zt.collections | collection_paths",
    merge: "replace",
    language: "liquid",
  },
  {
    key: "citekey",
    expr: "zt.citationKey",
    merge: "replace",
    language: "liquid",
  },
]) satisfies readonly FrontmatterField[];

const TEMPLATE_FILE = regex(
  "^zotlit-(?<name>[A-Za-z0-9-]+)\\.(?<language>liquid|eta)\\.md$",
);

const PARTIAL_FILE = regex("^zotlit-partial\\.(?<name>[A-Za-z0-9-]+)\\.md$");

const TEMPLATE_DOCUMENT_PREFIX = "zotlit-";

const PROFILE_DOCUMENT_PREFIX = "zotlit-profile.";

const CITATION_DOCUMENT_FILENAME = "zotlit-citation.md";

export const CITATION_TEMPLATE_NAME = "citation" as const;

export const CITATION_TEMPLATE_SOURCE = citation;

export const MANAGED_CONTENT_TEMPLATE = "content" as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

export const TEMPLATE_NAMES = [
  "filename",
  "note",
  "annotation",
  MANAGED_CONTENT_TEMPLATE,
] as const;

export const LEGACY_CITATION_NAMES = ["cite", "cite2"] as const;

export type LegacyCitationName = (typeof LEGACY_CITATION_NAMES)[number];

export const DEFAULT_TEMPLATES: Record<TemplateName, string> = {
  filename,
  note,
  annotation,
  content,
};

function templateFilename(name: string, language: TemplateLanguage): string {
  return `zotlit-${name}.${language}.md`;
}

export function templatePath(
  folder: string,
  name: string,
  language: TemplateLanguage = "liquid",
): string {
  const file = templateFilename(name, language);
  const normalizedFolder = normalizeVaultPath(folder);
  return normalizedFolder === "" ? file : join(normalizedFolder, file);
}

export function templateFileFromPath(
  path: string,
): { name: string; language: TemplateLanguage } | null {
  const match = TEMPLATE_FILE.exec(basename(normalizeVaultPath(path)));
  if (!match) return null;
  return { name: match.groups.name, language: match.groups.language };
}

export function citationPath(folder: string): string {
  const normalizedFolder = normalizeVaultPath(folder);
  return normalizedFolder === ""
    ? CITATION_DOCUMENT_FILENAME
    : join(normalizedFolder, CITATION_DOCUMENT_FILENAME);
}

export function partialFilename(name: string): string {
  return `zotlit-partial.${name}.md`;
}

export const RESERVED_PARTIAL_NAME_LIST: readonly string[] = [
  ...TEMPLATE_NAMES,
  CITATION_TEMPLATE_NAME,
];

export const RESERVED_PARTIAL_NAMES: ReadonlySet<string> = new Set<string>(
  RESERVED_PARTIAL_NAME_LIST,
);

const PARTIAL_NAME = /^[A-Za-z0-9-]+$/;
const PARTIAL_NAME_SPACES = /\s+/g;

export function isPartialNameShape(name: string): boolean {
  return PARTIAL_NAME.test(name);
}

export type PartialNameRefusal =
  | "empty"
  | "characters"
  | "reserved"
  | "duplicate";

export function normalizePartialName(input: string): string {
  return input.trim().replaceAll(PARTIAL_NAME_SPACES, "-").toLowerCase();
}

export function partialNameRefusal(
  name: string,
  taken: Iterable<string>,
): PartialNameRefusal | null {
  if (name === "") return "empty";
  if (!isPartialNameShape(name)) return "characters";
  if (RESERVED_PARTIAL_NAMES.has(name)) return "reserved";
  const folded = name.toLowerCase();
  return [...taken].some((used) => used.toLowerCase() === folded)
    ? "duplicate"
    : null;
}

export function partialPath(folder: string, name: string): string {
  const file = partialFilename(name);
  const normalizedFolder = normalizeVaultPath(folder);
  return normalizedFolder === "" ? file : join(normalizedFolder, file);
}

export type TemplateFolderFile =
  | { kind: "profile"; reference: string }
  | { kind: "citation" }
  | { kind: "partial"; name: string }
  | { kind: "legacy-slot"; name: TemplateName; language: TemplateLanguage }
  | {
      kind: "legacy-citation";
      name: LegacyCitationName;
      language: TemplateLanguage;
    }
  | { kind: "legacy-partial"; name: string; language: TemplateLanguage }
  | { kind: "unrecognized" };

export function inTemplateFolder(path: string, folder: string): boolean {
  return (
    normalizeVaultPath(dirname(normalizeVaultPath(path))) ===
    normalizeVaultPath(folder)
  );
}

export function classifyTemplateFolderFile(
  path: string,
): TemplateFolderFile | null {
  const filename = basename(normalizeVaultPath(path));
  if (!filename.startsWith(TEMPLATE_DOCUMENT_PREFIX)) return null;
  if (!filename.endsWith(".md")) return null;

  if (filename.startsWith(PROFILE_DOCUMENT_PREFIX)) {
    return { kind: "profile", reference: filename };
  }
  if (filename === CITATION_DOCUMENT_FILENAME) return { kind: "citation" };

  const partial = PARTIAL_FILE.exec(filename);
  if (partial) return { kind: "partial", name: partial.groups.name };

  const legacy = TEMPLATE_FILE.exec(filename);
  if (legacy) {
    const { name, language } = legacy.groups;
    if (isTemplateName(name)) return { kind: "legacy-slot", name, language };
    if (isLegacyCitationName(name)) {
      return { kind: "legacy-citation", name, language };
    }
    if (name !== CITATION_TEMPLATE_NAME) {
      return { kind: "legacy-partial", name, language };
    }
  }
  return { kind: "unrecognized" };
}

export function isTemplateName(name: string): name is TemplateName {
  return (TEMPLATE_NAMES as readonly string[]).includes(name);
}

export function isLegacyCitationName(name: string): name is LegacyCitationName {
  return (LEGACY_CITATION_NAMES as readonly string[]).includes(name);
}
