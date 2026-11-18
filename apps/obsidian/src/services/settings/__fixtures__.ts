import type { Plugin } from "obsidian";

import type { ResolvedLiteratureNoteProfileBindings } from "@zotlit/notes/obsidian/profile/bindings.ts";
import { updateDefaultLiteratureNoteProfileBindings } from "@zotlit/notes/obsidian/profile/settings.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import {
  buildSettings as buildHostSettings,
  settingsOf as hostSettingsOf,
  settingsRuntimeOf as hostSettingsRuntimeOf,
} from "@zotlit/plugin-services/__fixtures__/settings.ts";
import type { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import type {
  PluginSettingsOptions,
  Settings,
} from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { withHost } from "@/services/settings/layer.ts";

export type { SettingsFixture } from "@zotlit/plugin-services/__fixtures__/settings.ts";

export type SettingsFixtureOptions = Partial<PluginSettingsOptions> & {
  plugin: Pick<Plugin, "loadData" | "saveData">;
};

/** The platform fixtures' options, under this plugin's definition and migrations. */
const hostOptions = ({ plugin, ...options }: SettingsFixtureOptions) => ({
  plugin,
  ...withHost(options),
});

export const settingsOf = (options: SettingsFixtureOptions) =>
  hostSettingsOf(hostOptions(options));

/**
 * The settings service, its bridge, and its runtime, using the test's Clock and
 * logger; all three close with the test Scope.
 */
export const settingsRuntimeOf = (options: SettingsFixtureOptions) =>
  hostSettingsRuntimeOf(hostOptions(options));

/** Consumer fixtures outside Effect own the service's runtime through this handle. */
export const buildSettings = (options: SettingsFixtureOptions) =>
  buildHostSettings(hostOptions(options));

/** Values a test seeds: persisted settings, and default Profile bindings by name. */
export type SettingsOverrides = Partial<Settings> &
  Partial<ResolvedLiteratureNoteProfileBindings>;

const BINDING_KEYS = [
  "note.literature-folder",
  "citation.references-style",
  "note.import-folder",
  "note.import-colored-highlights",
  "note.import-annotations-as-template",
] as const satisfies readonly (keyof ResolvedLiteratureNoteProfileBindings)[];

/**
 * Writes `overrides` through the real store: settings through `update`, and a
 * binding name through the default Profile's bindings.
 */
export function applySettings(
  settings: Pick<PluginSettings["Service"], "update">,
  bridge: Pick<EffectBridge, "runSync">,
  overrides: SettingsOverrides,
): void {
  const persisted: Record<string, unknown> = { ...overrides };
  const bindings: Record<string, unknown> = {};
  for (const key of BINDING_KEYS) {
    if (!(key in persisted)) continue;
    bindings[key] = persisted[key];
    delete persisted[key];
  }
  if (Object.keys(persisted).length > 0)
    bridge.runSync(settings.update(persisted as Partial<Settings>));
  if (Object.keys(bindings).length > 0)
    bridge.runSync(
      updateDefaultLiteratureNoteProfileBindings(
        settings,
        bindings as Partial<ResolvedLiteratureNoteProfileBindings>,
      ),
    );
}

/** The real store over empty plugin data, seeded with `overrides`. */
export async function buildSeededSettings(overrides: SettingsOverrides = {}) {
  const settings = await buildSettings({
    plugin: {
      loadData: () => Promise.resolve(null),
      saveData: () => Promise.resolve(),
    },
  });
  applySettings(settings, settings.bridge, overrides);
  return settings;
}
