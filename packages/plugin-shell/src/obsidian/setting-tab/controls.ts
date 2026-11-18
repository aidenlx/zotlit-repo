import type { ControlCodec, Feature } from "#obsidian/feature.ts";
// The declarative `control` rows' storage: a control key a feature claims
// reads and writes through that feature's codec, and every other key reads
// and writes the settings store as it is.
import { Effect } from "effect";

import type { SettingsKey } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

/** The codec of the first feature that claims `key`, if any. */
function codecOf(
  features: readonly Feature<any, any, any>[],
  key: string,
): ControlCodec | undefined {
  for (const feature of features)
    for (const codec of feature.settingTab.controls ?? [])
      if (codec.claims(key)) return codec;
  return undefined;
}

/** A declarative `control`'s value, encoded for the control that shows it. */
export function controlValue(
  features: readonly Feature<any, any, any>[],
  key: string,
) {
  const codec = codecOf(features, key);
  if (codec) return codec.read(key);
  return PluginSettings.use((settings) => settings.current).pipe(
    Effect.map((current): unknown => current[key as SettingsKey]),
  );
}

/** Store a declarative `control`'s value, decoded from its control. */
export function writeControlValue(
  features: readonly Feature<any, any, any>[],
  key: string,
  value: unknown,
) {
  const codec = codecOf(features, key);
  if (codec) return codec.write(key, value);
  // `key` is constrained to schema keys by every `control` definition, and
  // `value` matches that key's control type, so the patch always validates.
  return PluginSettings.use((settings) => settings.update({ [key]: value }));
}
