import { Effect, Queue, Stream } from "effect";
import type {
  DropdownComponent,
  ExtraButtonComponent,
  Setting,
  SettingDefinitionItem,
  SettingDefinitionPage,
} from "obsidian";

import { citationLocaleError } from "@zotlit/citations/core/citation-index/settings.ts";
import type { HoverAction } from "@zotlit/citations/core/citation-index/settings.ts";
import {
  referencesStyleOptions,
  STYLE_DEFAULT,
} from "@zotlit/citations/core/pandoc/citation-style.ts";
import type { InstalledCslStyle } from "@zotlit/citations/core/pandoc/csl-style.ts";
import { listInstalledStyles } from "@zotlit/citations/desktop/pandoc/installed-styles.ts";
import { GRAPH_CORE_PLUGIN_ID } from "@zotlit/citations/obsidian/graph-citations/install.ts";
import { updateDefaultLiteratureNoteProfileBindings } from "@zotlit/notes/obsidian/profile/settings.ts";
import { ANNOTATION_SUGGESTER_ENABLED } from "@zotlit/plugin-kernel/constants.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import {
  resolvedChanged,
  ZoteroPref,
} from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { annotationTriggerError } from "@zotlit/query-views/core/annotation-suggest/annotation-trigger.ts";

import { defaults } from "@/services/settings/schema.ts";

import type { SettingsKey, SettingTabContext } from "./context.ts";
import { zoteroDataDir } from "./database.ts";
import { paintEach } from "./effect-tab.ts";
import { pandocEngineDefinition } from "./pandoc-engine.ts";
import { pandocIntegrationDefinition } from "./pandoc-integration.ts";
import { citationTextItems } from "./templates.ts";

const currentSettings = PluginSettings.use((settings) => settings.current);

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
        ...(ANNOTATION_SUGGESTER_ENABLED
          ? [
              {
                id: "settings_citation_annotation_trigger",
                name: m.settings_citation_annotation_trigger_name(),
                desc: m.settings_citation_annotation_trigger_desc(),
                control: {
                  type: "text",
                  key: "citation.annotation-trigger",
                  placeholder: defaults["citation.annotation-trigger"],
                  validate: annotationTriggerError,
                },
              } satisfies SettingDefinitionItem<SettingsKey>,
            ]
          : []),
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
    ...citationTextItems(ctx),
    pandocIntegrationDefinition(ctx),
  ];
}

/** The default Profile's Citation and References Style control. */
export function referencesStyleDefinition(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey> {
  return {
    id: "settings_citation_references_style",
    name: m.settings_citation_references_style_name(),
    desc: referencesStyleDescription(false),
    render: (setting) => renderReferencesStyleRow(setting, ctx),
  };
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

/**
 * Citation and References Style picker, listing the styles installed in the Zotero data
 * directory. Zotero owns style installation, so the list is read-only, and the
 * row follows both the Zotero data directory and the stored setting, which
 * vault sync can rewrite while the tab is open.
 */
function renderReferencesStyleRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  let dropdown: DropdownComponent | undefined;
  let styles: readonly InstalledCslStyle[] = [];
  let stylesLoaded = false;

  const selectedValue = (current: Readonly<Settings>): string =>
    current["note.default-profile"].bindings["citation.references-style"] ??
    STYLE_DEFAULT;

  const repopulate = (settings: Readonly<Settings>): void => {
    if (!dropdown) return;
    const current = selectedValue(settings);
    setting.setDesc(
      referencesStyleDescription(
        stylesLoaded &&
          current !== STYLE_DEFAULT &&
          !styles.some((style) => style.id === current),
      ),
    );
    dropdown.selectEl.replaceChildren();
    for (const { value, label } of referencesStyleOptions(styles, current)) {
      dropdown.addOption(value, label);
    }
    dropdown.setValue(current);
  };

  // Zotero installs styles while this tab stays open, so the list re-reads the
  // data directory on demand instead of only on mount.
  let refresh: ExtraButtonComponent | undefined;
  setting.addExtraButton((button) => {
    refresh = button
      .setIcon("refresh-cw")
      .setTooltip(m.settings_citation_references_style_refresh());
  });

  setting.addDropdown((d) => {
    dropdown = d;
    d.onChange((value) => {
      void ctx.tab.run(
        PluginSettings.use((settings) =>
          updateDefaultLiteratureNoteProfileBindings(settings, {
            "citation.references-style": value === STYLE_DEFAULT ? null : value,
          }),
        ),
        m.settings_failed_save(),
      );
    });
    repopulate(ctx.tab.sync(currentSettings));
  });

  return ctx.tab.mount(
    Effect.gen(function* () {
      const settings = yield* PluginSettings;
      const pref = yield* ZoteroPref;
      const reloads = yield* Queue.unbounded<void>();
      refresh?.onClick(() => Queue.offerUnsafe(reloads, undefined));

      yield* Effect.forkScoped(
        paintEach(settings.changes, (current) => {
          if (dropdown && dropdown.getValue() !== selectedValue(current))
            repopulate(current);
        }),
      );
      // The list reads the data directory on mount, on Refresh, and when the
      // directory moves; a newer read drops the one still in flight.
      yield* Stream.merge(
        Stream.make(undefined),
        Stream.merge(resolvedChanged(pref), Stream.fromQueue(reloads)),
      ).pipe(
        // A failed read keeps the last list, so the row stays live.
        Stream.switchMap(() =>
          Stream.fromEffect(
            installedStyles.pipe(
              recover(
                (cause) =>
                  Effect.logWarning(
                    "Cannot read the installed CSL styles",
                    cause,
                  ),
                Effect.sync(() => styles),
              ),
            ),
          ),
        ),
        Stream.runForEach((installed) =>
          Effect.map(settings.current, (current) => {
            styles = installed;
            stylesLoaded = true;
            repopulate(current);
          }),
        ),
      );
    }),
  );
}

/** The CSL styles installed in the current Zotero data directory. */
const installedStyles = Effect.flatMap(zoteroDataDir, (dataDir) =>
  listInstalledStyles(dataDir),
);

export function referencesStyleDescription(missing: boolean): DocumentFragment {
  const desc = createFragment();
  desc.append(
    missing
      ? m.settings_citation_references_style_warning()
      : m.settings_citation_references_style_desc(),
  );
  return desc;
}
