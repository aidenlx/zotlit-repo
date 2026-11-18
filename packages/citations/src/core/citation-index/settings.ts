// The Citation keys of the plugin settings, registered in the platform's
// settings registry; a host composes the slice into its definition.
import * as v from "valibot";

import { isLanguageTag } from "@zotlit/plugin-kernel/language-tag.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { settingsSlice } from "@zotlit/plugin-services/core/settings/slice.ts";
import type { SliceSettings } from "@zotlit/plugin-services/core/settings/slice.ts";

/**
 * What hovering a recognized citation or Literature Note link shows. One hover
 * result at a time: the Citation Popover and the page preview are never both
 * reachable, and `off` leaves hover entirely to Obsidian.
 */
const hoverAction = v.picklist(["off", "popover", "page-preview"]);
export type HoverAction = v.InferOutput<typeof hoverAction>;

export const citationSettings = settingsSlice(
  {
    "citation.editor-suggester": v.boolean(),
    "citation.at-trigger": v.boolean(),
    /**
     * The text that opens the Annotation Suggester; empty turns it off. A
     * trigger that overlaps a citation trigger opens nothing.
     */
    "citation.annotation-trigger": v.string(),
    /** Include Pandoc citation syntax in the shared document citation set. */
    "citation.pandoc-citations": v.boolean(),
    /** Treat Literature Note wikilinks as Citations in the index-backed UI. */
    "citation.wikilink-citations": v.boolean(),
    /** Treat Zotero annotation links with no link text as Citations of the annotation's item. */
    "citation.annotation-citations": v.boolean(),
    /** Add Graph Citations — citation edges and Cited Work Nodes — to Obsidian's graph views. */
    "citation.graph-citations": v.boolean(),
    /** Show recognized Citations with the selected CSL style. */
    "citation.show-formatted": v.boolean(),
    /**
     * Show an Annotation Citation in its place as its formatted text. Takes
     * effect with `citation.annotation-citations` and `citation.show-formatted`.
     */
    "citation.render-annotation-citations": v.boolean(),
    /**
     * Navigate to the Literature Note when a Citation is clicked, on both Pandoc
     * Citations and Literature Note wikilinks rendered as Citations.
     */
    "citation.open-as-links": v.boolean(),
    /**
     * Citation Locale as a BCP 47 tag; `null` or empty leaves the selected CSL
     * style's own default locale in charge.
     */
    "citation.locale": v.nullable(v.string()),
    /** What hovering a Citation shows, on every surface that carries one. */
    "citation.hover-action": hoverAction,
    /** Whether the Citation Popover needs a held Mod, per surface. */
    "citation.hover-require-mod-source": v.boolean(),
    "citation.hover-require-mod-live-preview": v.boolean(),
    "citation.hover-require-mod-reading": v.boolean(),
    "citation.hover-require-mod-graph": v.boolean(),
  },
  {
    "citation.editor-suggester": true,
    "citation.at-trigger": false,
    // A bracket like the Citation Suggester's `[@`, and `>` for a quote.
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
    // Source mode keeps the modifier so plain-text editing is never interrupted,
    // while the two rendered modes answer to bare hover.
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

/**
 * @returns why the Citation Locale was refused, or nothing for one the CSL
 *   processor reads — an empty value included, which is Style default.
 */
export function citationLocaleError(locale: string): string | undefined {
  if (locale === "" || isLanguageTag(locale)) return undefined;
  return m.settings_citation_locale_invalid();
}
