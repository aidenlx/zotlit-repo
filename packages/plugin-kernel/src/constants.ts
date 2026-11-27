/// <reference path="./typings/build-env.d.ts" />

export const DOCS_SITE_URL = __DOCS_SITE_URL__;
export const COMPANION_ADDON_ID = "zotlit@aidenlx.site";
export const ANNOTATION_SUGGESTER_ENABLED = __ANNOTATION_SUGGESTER_ENABLED__;

export const EXTERNAL_FILE_PREFIX = "file:";

export const FIELD_ZOTERO_KEY = "zotero-key";
export const FIELD_LITERATURE_NOTE_PROFILE = "zotlit-profile";
export const FIELD_CITEKEY = "citekey";
export const FIELD_CITATION_STYLE = "zotlit-csl";
export const FIELD_DOCUMENT_LANGUAGE = "lang";
export const FIELD_ZOTERO_NOTE_KEY = "zotero-note-key";
export const FIELD_ZOTERO_LASTMOD = "zotero-lastmod";
export function stringifyInstant(
  instant: Temporal.Instant,
  options?: { utc: boolean },
): string {
  if (options?.utc) {
    return instant.toString({ smallestUnit: "second" });
  }
  return instant
    .toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toString({ smallestUnit: "second", timeZoneName: "never" });
}

export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  FIELD_ZOTERO_KEY,
  FIELD_LITERATURE_NOTE_PROFILE,
  FIELD_ZOTERO_NOTE_KEY,
  FIELD_ZOTERO_LASTMOD,
]);

export const NON_VAULT_PROPERTY_KEYS: ReadonlySet<string> = new Set([
  "tags",
  "aliases",
  "cssclasses",
  ...RESERVED_KEYS,
  FIELD_CITATION_STYLE,
]);

export const ZOTERO_DB_FILENAME = "zotero.sqlite";
export const ZOTERO_WAL_FILENAME = "zotero.sqlite-wal";
export const ZOTERO_DB_READ_TEMP_PREFIX = "zotlit-db-";
export const ZOTERO_DB_READ_PARENT_DIRNAME = ".zotlit-db-reads";
