import { getLanguage } from "obsidian";

import { DOCS_SITE_URL } from "@zotlit/plugin-kernel/constants.ts";
import { resolvePluginLocale } from "@zotlit/plugin-kernel/i18n/locale.ts";

export function docsUrl(path: string): string {
  const chinese = resolvePluginLocale(getLanguage()) === "zh-CN";
  return `${DOCS_SITE_URL}${chinese ? "/zh-CN" : ""}${path}`;
}

export const companionDocsUrl = (): string =>
  docsUrl("/docs/install-companion");

export const communityUrl = (): string => docsUrl("/community");
