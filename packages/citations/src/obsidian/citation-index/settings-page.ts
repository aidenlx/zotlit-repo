import type { HoverAction } from "#core/citation-index/settings.ts";
// The "Citations" page: how citations are suggested, read, shown on hover
// and formatted. The Annotation trigger row comes from the query views, the
// Citation text row from the notes, and the native Pandoc rows from the
// desktop citations, each through the page's slots.
import type {
  SettingDefinitionItem,
  SettingDefinitionPage,
  SettingGroupItem,
} from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { citationLocaleError } from "#core/citation-index/settings.ts";
import { GRAPH_CORE_PLUGIN_ID } from "#obsidian/graph-citations/install.ts";
import { pandocEngineDefinition } from "#obsidian/pandoc/engine-settings-row.ts";

declare module "@zotlit/plugin-services/obsidian/setting-tab/context.ts" {
  interface SettingTabSlots {
    /** The Citation suggestions group, after its own rows. */
    "citations.suggestions": unknown;
    /** The Citations page, after the Formatting group: the citation text. */
    "citations.citation-text": unknown;
    /** The Citations page's last rows: the native Pandoc workflow. */
    "citations.native-pandoc": unknown;
  }
}

/** The slots the Citations page holds. */
export const citationsPageSlots = {
  suggestions: "citations.suggestions",
  citationText: "citations.citation-text",
  nativePandoc: "citations.native-pandoc",
} as const;

const currentSettings = PluginSettings.use((settings) => settings.current);

export function citationsPage(
  ctx: SettingTabContext,
): SettingDefinitionPage<SettingsKey> {
  return {
    type: "page",
    id: "settings_page_citations",
    name: m.settings_page_citations(),
    desc: m.settings_page_citations_desc(),
    items: citationsPageItems(ctx),
  };
}

/** Items for the "Citations" sub-page. */
export function citationsPageItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  return [
    {
      type: "group",
      id: "settings_citation_suggestions",
      heading: m.settings_citation_suggestions_heading(),
      items: [
        {
          id: "settings_citation_suggester",
          name: m.settings_citation_suggester_name(),
          desc: m.settings_citation_suggester_desc(),
          control: { type: "toggle", key: "citation.editor-suggester" },
        },
        {
          id: "settings_citation_at_trigger",
          name: m.settings_citation_at_trigger_name(),
          desc: m.settings_citation_at_trigger_desc(),
          visible: () =>
            ctx.tab.sync(currentSettings)["citation.editor-suggester"],
          control: { type: "toggle", key: "citation.at-trigger" },
        },
        {
          id: "settings_citation_show_citekey",
          name: m.settings_citation_show_citekey_name(),
          desc: m.settings_citation_show_citekey_desc(),
          control: {
            type: "toggle",
            key: "citation.show-citekey-in-suggester",
          },
        },
        ...(ctx.slot(
          citationsPageSlots.suggestions,
        ) as SettingGroupItem<SettingsKey>[]),
      ],
    },
    {
      type: "group",
      id: "settings_citation_sources",
      heading: m.settings_citation_sources_heading(),
      items: [
        {
          id: "settings_citation_pandoc_citations",
          name: m.settings_citation_pandoc_citations_name(),
          desc: m.settings_citation_pandoc_citations_desc(),
          control: { type: "toggle", key: "citation.pandoc-citations" },
        },
        {
          id: "settings_citation_wikilink_citations",
          name: m.settings_citation_wikilink_citations_name(),
          desc: m.settings_citation_wikilink_citations_desc(),
          control: { type: "toggle", key: "citation.wikilink-citations" },
        },
        {
          id: "settings_citation_annotation_citations",
          name: m.settings_citation_annotation_citations_name(),
          desc: m.settings_citation_annotation_citations_desc(),
          control: { type: "toggle", key: "citation.annotation-citations" },
        },
      ],
    },
    {
      type: "group",
      id: "settings_citation_graph_heading",
      heading: m.settings_citation_graph_heading(),
      items: [
        {
          id: "settings_citation_graph",
          name: m.settings_citation_graph_name(),
          desc: graphCitationsDescription(ctx),
          control: { type: "toggle", key: "citation.graph-citations" },
        },
      ],
    },
    {
      type: "group",
      id: "settings_citation_editor",
      heading: m.settings_citation_editor_heading(),
      items: [
        {
          id: "settings_citation_show_formatted",
          name: m.settings_citation_show_formatted_name(),
          desc: m.settings_citation_show_formatted_desc(),
          control: { type: "toggle", key: "citation.show-formatted" },
        },
        {
          id: "settings_citation_render_annotation_citations",
          name: m.settings_citation_render_annotation_citations_name(),
          desc: m.settings_citation_render_annotation_citations_desc(),
          control: {
            type: "toggle",
            key: "citation.render-annotation-citations",
          },
        },
        {
          id: "settings_citation_open_as_links",
          name: m.settings_citation_open_as_links_name(),
          desc: m.settings_citation_open_as_links_desc(),
          control: { type: "toggle", key: "citation.open-as-links" },
        },
      ],
    },
    {
      type: "group",
      id: "settings_citation_hover",
      heading: m.settings_citation_hover_heading(),
      items: [
        {
          id: "settings_citation_hover_action",
          name: m.settings_citation_hover_action_name(),
          desc: m.settings_citation_hover_action_desc(),
          control: {
            type: "dropdown",
            key: "citation.hover-action",
            options: hoverActionOptions(),
          },
        },
        requireModPage(ctx),
      ],
    },
    {
      type: "group",
      id: "settings_citation_references",
      heading: m.settings_citation_references_heading(),
      items: [
        {
          id: "settings_citation_locale",
          name: m.settings_citation_locale_name(),
          desc: m.settings_citation_locale_desc(),
          control: {
            type: "text",
            key: "citation.locale",
            // Empty leaves the selected style's own default locale in charge.
            defaultValue: "",
            placeholder: m.settings_citation_locale_default(),
            validate: citationLocaleError,
          },
        },
        pandocEngineDefinition(ctx),
      ],
    },
    ...ctx.slot(citationsPageSlots.citationText),
    ...ctx.slot(citationsPageSlots.nativePandoc),
  ];
}

/**
 * Names the Graph view core plugin while it is disabled, since the toggle
 * then changes nothing on screen. Read at build time: the page is rebuilt on
 * every open, which is when a core-plugin change can reach it.
 */
function graphCitationsDescription(ctx: SettingTabContext): string {
  return ctx.app.internalPlugins.getEnabledPluginById(GRAPH_CORE_PLUGIN_ID)
    ? m.settings_citation_graph_desc()
    : m.settings_citation_graph_desc_disabled();
}

/** The Hover Action choices, in the order the select offers them. */
function hoverActionOptions(): Record<HoverAction, string> {
  return {
    off: m.settings_citation_hover_action_off(),
    popover: m.settings_citation_hover_action_popover(),
    "page-preview": m.settings_citation_hover_action_page_preview(),
  };
}

/** The Require Mod toggles for editing modes and graph views. */
const REQUIRE_MOD_KEYS = [
  [
    "citation.hover-require-mod-source",
    "settings_citation_hover_mod_source",
    m.settings_citation_hover_mod_source_name,
  ],
  [
    "citation.hover-require-mod-live-preview",
    "settings_citation_hover_mod_live_preview",
    m.settings_citation_hover_mod_live_preview_name,
  ],
  [
    "citation.hover-require-mod-reading",
    "settings_citation_hover_mod_reading",
    m.settings_citation_hover_mod_reading_name,
  ],
  [
    "citation.hover-require-mod-graph",
    "settings_citation_hover_mod_graph",
    m.settings_citation_hover_mod_graph_name,
  ],
] as const satisfies readonly (readonly [SettingsKey, string, () => string])[];

/**
 * The Require Mod toggles, on a sub-page of their own that lists one hover
 * surface per row, like the Page preview plugin lists one hover source per row.
 * The page's own title names the list, so the rows carry the requirement in the
 * page description instead of repeating it on each row.
 *
 * The toggles gate the Citation Popover alone — under Page preview the Page
 * preview plugin's own settings own that gate, and under Off there is nothing
 * to gate — so the entry appears under the Citation Popover alone.
 */
function requireModPage(
  ctx: SettingTabContext,
): SettingDefinitionPage<SettingsKey> {
  return {
    type: "page",
    id: "settings_citation_hover_mod_page",
    name: m.settings_citation_hover_mod_page_name(),
    desc: m.settings_citation_hover_mod_desc(),
    visible: () =>
      ctx.tab.sync(currentSettings)["citation.hover-action"] === "popover",
    items: REQUIRE_MOD_KEYS.map(([key, id, name]) => ({
      id,
      name: name(),
      control: { type: "toggle", key },
    })),
  };
}
