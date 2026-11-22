import type { LogLevel } from "@zotlit/plugin-services/core/log/settings.ts";
import { isPlainObject } from "@zotlit/plugin-services/core/settings/classify.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";

import { defaults } from "./schema.ts";

const DEFAULT_CITEKEY_FIELD = {
  key: "citekey",
  expr: "zt.citationKey",
  merge: "replace",
  language: "liquid",
} as const;

type V0LogLevel =
  | "ALL"
  | "TRACE"
  | "DEBUG"
  | "INFO"
  | "WARN"
  | "ERROR"
  | "FATAL"
  | "MARK"
  | "OFF";

type V0TrimConfig = "nl" | "slurp" | false;

type V0EmbededTplType = "filename";

export interface ZotLitSettingsV0 {
  logLevel: V0LogLevel;

  citationEditorSuggester: boolean;
  showCitekeyInSuggester: boolean;

  literatureNoteFolder: string;

  enableServer: boolean;
  serverPort: number;
  serverHostname: string;

  template: { folder: string; templates: Record<V0EmbededTplType, string> };
  autoPairEta: boolean;
  autoTrim: [V0TrimConfig, V0TrimConfig];

  autoRefresh: boolean;

  imgExcerptImport: false | "symlink" | "copy";
  imgExcerptPath: string;
}

export function migrateLegacyV0(raw: unknown): Partial<Settings> {
  if (!isPlainObject(raw)) return {};
  const v0 = raw as Partial<Record<keyof ZotLitSettingsV0, unknown>>;
  const out: Record<string, unknown> = {};

  for (const [fromKey, toKey] of V0_KEY_MAP) {
    if (v0[fromKey] !== undefined) out[toKey] = v0[fromKey];
  }

  const logLevel = mapLogLevel(v0.logLevel);
  if (logLevel !== undefined) out["log.level"] = logLevel;

  if (isPlainObject(v0.template) && typeof v0.template.folder === "string") {
    out["template.folder"] = v0.template.folder;
  }

  if (Array.isArray(v0.autoTrim) && v0.autoTrim.length === 2) {
    out["template.auto-trim-leading"] = v0.autoTrim[0];
    out["template.auto-trim-trailing"] = v0.autoTrim[1];
  }

  if (v0.imgExcerptImport !== undefined) {
    out["attachment.import"] = v0.imgExcerptImport !== false;
  }

  dropLegacyDefaultValues(out);
  return out;
}

const V0_KEY_MAP: ReadonlyArray<
  readonly [keyof ZotLitSettingsV0, keyof Settings | "note.literature-folder"]
> = [
  ["citationEditorSuggester", "citation.editor-suggester"],
  ["showCitekeyInSuggester", "citation.show-citekey-in-suggester"],
  ["literatureNoteFolder", "note.literature-folder"],
  ["enableServer", "server.enabled"],
  ["serverPort", "server.port"],
  ["serverHostname", "server.hostname"],
  ["autoRefresh", "zotero.auto-refresh"],
  ["imgExcerptPath", "attachment.folder-path"],
];

function mapLogLevel(value: unknown): LogLevel | undefined {
  if (typeof value !== "string") return undefined;
  switch (value as V0LogLevel) {
    case "ALL":
    case "TRACE":
      return "trace";
    case "DEBUG":
      return "debug";
    case "INFO":
      return "info";
    case "WARN":
      return "warning";
    case "ERROR":
      return "error";
    case "FATAL":
      return "fatal";
    case "OFF":
      return null;
    default:
      return undefined;
  }
}

const PRESERVED_V0_FOLDER_KEYS = new Set([
  "note.literature-folder",
  "template.folder",
]);

function dropLegacyDefaultValues(out: Record<string, unknown>): void {
  for (const key of Object.keys(out)) {
    if (PRESERVED_V0_FOLDER_KEYS.has(key)) continue;
    const legacyDefault = getLegacyDefaultValue(key);
    if (legacyDefault === undefined) continue;
    if (Object.is(out[key], legacyDefault)) {
      delete out[key];
    }
  }
}

function getLegacyDefaultValue(key: string): unknown {
  if (key === "attachment.import") return true;
  if (key === "attachment.folder-path") return "ZtImgExcerpt";
  if (key === "log.level") return "info";
  if (!Object.hasOwn(defaults, key)) return undefined;
  return defaults[key as keyof Settings];
}

const V1_DEFAULT_JS_TO_V2_LIQUID: ReadonlyMap<string, string> = new Map([
  ["zt.title", "zt.title"],
  [
    "zt.relatedItems.map((i) => i.noteLink() ?? `zt-error:${i.indexedKey}`)",
    "zt.relatedItems | note_links",
  ],
  [
    'zt.collections.map((c) => c.path.join("/"))',
    "zt.collections | collection_paths",
  ],
]);

export function migrateV1ToV2(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};

  const out: Record<string, unknown> = { ...raw };
  const fields = out["note.frontmatter-fields"];
  if (Array.isArray(fields)) {
    out["note.frontmatter-fields"] = fields.map(migrateFrontmatterFieldV1ToV2);
  }
  return out;
}

function migrateFrontmatterFieldV1ToV2(item: unknown): unknown {
  if (!isPlainObject(item)) return item;

  const expr = item.expr;
  const liquidExpr =
    typeof expr === "string" ? V1_DEFAULT_JS_TO_V2_LIQUID.get(expr) : undefined;

  if (liquidExpr !== undefined) {
    return { ...item, expr: liquidExpr, language: "liquid" };
  }
  return { ...item, language: "javascript" };
}

export function migrateV2ToV3(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};

  const out: Record<string, unknown> = {
    ...raw,
    "citation.key-links": true,
    "citation.key-links-frontmatter-key": "citekey",
  };
  const fields = out["note.frontmatter-fields"];
  if (
    Array.isArray(fields) &&
    !fields.some((field) => isPlainObject(field) && field.key === "citekey")
  ) {
    out["note.frontmatter-fields"] = [...fields, DEFAULT_CITEKEY_FIELD];
  }
  return out;
}

export function migrateV3ToV4(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};

  const { "citation.key-links": keyLinks, ...rest } = raw;
  return { ...rest, "citation.citekey-editor": keyLinks === true };
}

export function migrateV4ToV5(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};
  const { "citation.key-links-frontmatter-key": _retired, ...rest } = raw;
  return rest;
}

export function migrateV5ToV6(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};
  const {
    "citation.citekey-indexing": citekeyIndexing,
    "citation.wikilink-display": _retiredWikilinkDisplay,
    ...rest
  } = raw;
  return typeof citekeyIndexing === "boolean"
    ? { ...rest, "citation.pandoc-citations": citekeyIndexing }
    : rest;
}

export function migrateV6ToV7(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};
  const { "citation.citekey-editor": citekeyEditor, ...rest } = raw;
  return typeof citekeyEditor === "boolean"
    ? { ...rest, "citation.open-pandoc-links": citekeyEditor }
    : rest;
}

export function migrateV7ToV8(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};
  const { "citation.open-pandoc-links": openPandocLinks, ...rest } = raw;
  return {
    ...rest,
    "citation.open-as-links":
      typeof openPandocLinks === "boolean" ? openPandocLinks : true,
  };
}

export function migrateV8ToV9(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};
  const { "zotero.citation-library": _retiredDefaultLibrary, ...rest } = raw;
  return {
    ...rest,
    "zotero.library-scope": {
      mode: "selected",
      libraries: [{ type: "personal" }],
    },
  };
}

export function migrateV9ToV10(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};
  const {
    "citation.references-style": citationStyle,
    "note.literature-folder": literatureFolder,
    "note.import-folder": importFolder,
    "note.import-colored-highlights": coloredHighlights,
    "note.import-annotations-as-template": annotationsAsTemplate,
    "note.default-profile": _defaultProfile,
    "note.profiles": _profiles,
    "note.template-pack-installs": _packs,
    ...rest
  } = raw;
  const base = defaults["note.default-profile"].bindings;
  return {
    ...rest,
    "note.default-profile": {
      bindings: {
        "citation.references-style":
          citationStyle === null || typeof citationStyle === "string"
            ? citationStyle
            : base["citation.references-style"],
        "note.literature-folder":
          typeof literatureFolder === "string"
            ? literatureFolder
            : base["note.literature-folder"],
        "note.import-folder":
          typeof importFolder === "string"
            ? importFolder
            : base["note.import-folder"],
        "note.import-colored-highlights":
          typeof coloredHighlights === "boolean"
            ? coloredHighlights
            : base["note.import-colored-highlights"],
        "note.import-annotations-as-template":
          typeof annotationsAsTemplate === "boolean"
            ? annotationsAsTemplate
            : base["note.import-annotations-as-template"],
      },
    },
  };
}

export function migrateV10ToV11(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};
  const {
    "citation.annotation-links": _annotationLinks,
    "citation.open-annotation-links": openAnnotationLinks,
    ...rest
  } = raw;
  return typeof openAnnotationLinks === "boolean"
    ? { ...rest, "reader.open-annotation-links": openAnnotationLinks }
    : rest;
}

export const settingsMigrations = {
  migrateLegacy: migrateLegacyV0,
  migrateV1: migrateV1ToV2,
  migrateV2: migrateV2ToV3,
  migrateV3: migrateV3ToV4,
  migrateV4: migrateV4ToV5,
  migrateV5: migrateV5ToV6,
  migrateV6: migrateV6ToV7,
  migrateV7: migrateV7ToV8,
  migrateV8: migrateV8ToV9,
  migrateV9: migrateV9ToV10,
  migrateV10: migrateV10ToV11,
};
