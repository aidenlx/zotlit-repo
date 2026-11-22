import { resolveLocale } from "@zotlit/obsidian-i18n";
import type { LocaleCatalog } from "@zotlit/obsidian-i18n";
import { catalog as zotlitCatalog } from "@zotlit/plugin-messages/catalog.ts";

const ALIASES = { zh: "zh-CN" } as const;

export function resolvePluginLocale(
  language: string,
  catalog: LocaleCatalog = zotlitCatalog,
): string {
  return resolveLocale(language, catalog, ALIASES);
}
