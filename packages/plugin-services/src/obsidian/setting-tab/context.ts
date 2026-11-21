import type { Settings } from "#core/settings/schema.ts";
import type { App, PluginManifest, SettingDefinitionItem } from "obsidian";

import type { SettingTabShape } from "./effect-tab.ts";

/** Settings keys, used to type declarative `control` bindings against the schema. */
export type SettingsKey = keyof Settings;

/**
 * The slots a page holds for rows another owner gives, by id. A page's owner
 * names each of its slots here by declaration merging (`declare module` on
 * this file); a feature fills a slot through its setting tab contribution.
 */
// oxlint-disable-next-line typescript/no-empty-object-type -- each page's owner fills it by declaration merging
export interface SettingTabSlots {}

/**
 * Shared dependencies every definition builder receives. Builders read services
 * lazily (inside `render`/predicate callbacks) so `getSettingDefinitions()`
 * itself stays cheap — it runs on every `update()` and once at registration for
 * search indexing.
 */
export interface SettingTabContext {
  /** Runs the tab's Effects on the tab layer's context and Scope. */
  tab: SettingTabShape;
  app: App;
  /**
   * The plugin's own manifest — its version and its folder in the vault. The
   * plugin object itself stays out of this context: its `services` getter is a
   * debug escape hatch that throws until `onload()` commits, and the first
   * `getSettingDefinitions()` runs inside `onload()`.
   */
  manifest: PluginManifest;
  /**
   * The rows the composed features give the slot `id`, in the host's feature
   * order; none when no composed feature fills it.
   */
  slot(id: keyof SettingTabSlots): SettingDefinitionItem<SettingsKey>[];
}
