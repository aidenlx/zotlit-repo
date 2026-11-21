import type { Feature, SettingRows } from "#obsidian/feature.ts";
// The plugin's declarative setting tab: the entries the features give, in the
// host's order.
import { PluginSettingTab } from "obsidian";
import type { Plugin, SettingDefinitionItem, SettingGroupItem } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";
import type {
  SettingsKey,
  SettingTabContext,
  SettingTabSlots,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

import { controlValue, writeControlValue } from "./controls.ts";

/**
 * Where the tab places each feature's entries: `top` on the main page, then
 * `pages` as one group of navigable sub-pages. Each id names an entry a
 * composed feature gives.
 */
export interface SettingTabOrder {
  readonly top: readonly string[];
  readonly pages: readonly string[];
}

/** The id of the group that holds the sub-pages. */
const PAGES_GROUP = "settings_pages";

/**
 * The tab of `features`. It holds no state of its own: every callback
 * Obsidian makes runs an Effect through `ctx.tab`, and the tab layer
 * (`layer.ts`) owns its subscriptions and lifetime.
 */
export class ShellSettingTab extends PluginSettingTab {
  readonly #ctx: SettingTabContext;
  readonly #features: readonly Feature<any, any, any>[];
  readonly #order: SettingTabOrder;

  constructor(
    plugin: Plugin,
    context: Pick<SettingTabContext, "tab">,
    {
      features,
      order,
    }: {
      readonly features: readonly Feature<any, any, any>[];
      readonly order: SettingTabOrder;
    },
  ) {
    super(plugin.app, plugin);
    this.#features = features;
    this.#order = order;
    this.#ctx = settingTabContext(plugin, context, features);
  }

  override getControlValue(key: string): unknown {
    return this.#ctx.tab.sync(controlValue(this.#features, key));
  }

  /**
   * Obsidian awaits this, then refreshes `visible`/`disabled` from the stored
   * value; it reports no failure itself, so `run` does.
   */
  override setControlValue(key: string, value: unknown): Promise<void> {
    return this.#ctx.tab.run(
      writeControlValue(this.#features, key, value),
      m.settings_failed_save(),
    );
  }

  override getSettingDefinitions(): SettingDefinitionItem<SettingsKey>[] {
    return settingDefinitions(this.#ctx, this.#features, this.#order);
  }
}

/** The context every entry of `features` builds from, its slots included. */
export function settingTabContext(
  plugin: Pick<Plugin, "app" | "manifest">,
  context: Pick<SettingTabContext, "tab">,
  features: readonly Feature<any, any, any>[],
): SettingTabContext {
  const ctx: SettingTabContext = {
    ...context,
    app: plugin.app,
    manifest: plugin.manifest,
    slot: (id) => slotRows(features, id, ctx),
  };
  return ctx;
}

/**
 * The tab's items: the `top` entries, then the `pages` entries, grouped apart
 * from the rows above so the page rows read as their own section.
 *
 * @throws when an id names an entry no composed feature gives.
 */
export function settingDefinitions(
  ctx: SettingTabContext,
  features: readonly Feature<any, any, any>[],
  order: SettingTabOrder,
): SettingDefinitionItem<SettingsKey>[] {
  const entries = new Map<string, SettingRows>();
  for (const feature of features)
    for (const [id, rows] of Object.entries(feature.settingTab.entries ?? {}))
      entries.set(id, rows);
  const rows = (id: string) => {
    const entry = entries.get(id);
    if (!entry)
      throw new Error(`No composed feature gives the setting entry ${id}`);
    return entry(ctx);
  };
  return [
    ...(order.top.flatMap(rows) as SettingDefinitionItem<SettingsKey>[]),
    {
      type: "group",
      id: PAGES_GROUP,
      items: order.pages.flatMap(rows) as SettingGroupItem<SettingsKey>[],
    },
  ];
}

/** The rows `features` give the slot `id`, in their order. */
function slotRows(
  features: readonly Feature<any, any, any>[],
  id: keyof SettingTabSlots,
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  return features.flatMap((feature) => {
    const slots: Partial<Record<string, SettingRows>> | undefined =
      feature.settingTab.slots;
    return slots?.[id]?.(ctx) ?? [];
  });
}
