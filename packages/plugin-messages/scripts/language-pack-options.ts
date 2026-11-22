export const EXCLUDE_MESSAGE_PREFIXES = [
  "docs_",
  "zotero.",
  "reader_",
  "pdf_reader_",
] as const;

export const INCLUDE_MESSAGES = [
  "zotero.prefs_notify_section",
  "zotero.prefs_notify_enable.label",
  "zotero.prefs_notify_url",
] as const;

export const TARGET_LOCALE_MESSAGE_PREFIXES = [
  "notice_language_pack_",
  "settings_language_pack_",
] as const;
