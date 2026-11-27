import { resolveZoteroLocale } from "@zotlit/zotero-compat";

import { AUTOMATIC_ZOTERO_LANGUAGE } from "#core/database/settings.ts";

export function effectiveZoteroLanguage(
  setting: string,
  systemLanguage: string | null,
): string {
  return setting === AUTOMATIC_ZOTERO_LANGUAGE
    ? resolveZoteroLocale(systemLanguage ?? "en-US")
    : setting;
}
