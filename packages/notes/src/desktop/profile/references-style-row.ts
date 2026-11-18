// The main page's Citation and references style row: the default Profile's
// style, picked from the CSL styles installed in the Zotero data directory.
import { Effect, Queue, Stream } from "effect";
import type {
  DropdownComponent,
  ExtraButtonComponent,
  Setting,
  SettingDefinitionItem,
} from "obsidian";

import {
  referencesStyleOptions,
  STYLE_DEFAULT,
} from "@zotlit/citations/core/pandoc/citation-style.ts";
import type { InstalledCslStyle } from "@zotlit/citations/core/pandoc/csl-style.ts";
import { listInstalledStyles } from "@zotlit/citations/desktop/pandoc/installed-styles.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import {
  resolvedChanged,
  ZoteroPref,
} from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { zoteroDataDir } from "@zotlit/plugin-services/desktop/database/settings-rows.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import { paintEach } from "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { updateDefaultLiteratureNoteProfileBindings } from "#obsidian/profile/settings.ts";

const currentSettings = PluginSettings.use((settings) => settings.current);

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
