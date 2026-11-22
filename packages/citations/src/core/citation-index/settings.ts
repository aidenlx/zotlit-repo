import * as v from "valibot";

import { isLanguageTag } from "@zotlit/plugin-kernel/language-tag.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { settingsSlice } from "@zotlit/plugin-services/core/settings/slice.ts";
import type { SliceSettings } from "@zotlit/plugin-services/core/settings/slice.ts";

const hoverAction = v.picklist(["off", "popover", "page-preview"]);
export type HoverAction = v.InferOutput<typeof hoverAction>;

export const citationSettings = settingsSlice(
  {
    "citation.editor-suggester": v.boolean(),
    "citation.at-trigger": v.boolean(),
    "citation.annotation-trigger": v.string(),
    "citation.pandoc-citations": v.boolean(),
    "citation.wikilink-citations": v.boolean(),
    "citation.annotation-citations": v.boolean(),
    "citation.graph-citations": v.boolean(),
    "citation.show-formatted": v.boolean(),
    "citation.render-annotation-citations": v.boolean(),
    "citation.open-as-links": v.boolean(),
    "citation.locale": v.nullable(v.string()),
    "citation.hover-action": hoverAction,
    "citation.hover-require-mod-source": v.boolean(),
    "citation.hover-require-mod-live-preview": v.boolean(),
    "citation.hover-require-mod-reading": v.boolean(),
    "citation.hover-require-mod-graph": v.boolean(),
  },
  {
    "citation.editor-suggester": true,
    "citation.at-trigger": false,
    "citation.annotation-trigger": "[>",
    "citation.pandoc-citations": true,
    "citation.wikilink-citations": false,
    "citation.annotation-citations": false,
    "citation.graph-citations": true,
    "citation.show-formatted": true,
    "citation.render-annotation-citations": false,
    "citation.open-as-links": false,
    "citation.locale": null,
    "citation.hover-action": "popover",
    "citation.hover-require-mod-source": true,
    "citation.hover-require-mod-live-preview": false,
    "citation.hover-require-mod-reading": false,
    "citation.hover-require-mod-graph": false,
  },
);

declare module "@zotlit/plugin-services/core/settings/schema.ts" {
  // oxlint-disable-next-line typescript/no-empty-object-type -- the slice adds its keys by declaration merging
  interface SettingsRegistry extends SliceSettings<typeof citationSettings> {}
}

export function citationLocaleError(locale: string): string | undefined {
  if (locale === "" || isLanguageTag(locale)) return undefined;
  return m.settings_citation_locale_invalid();
}
