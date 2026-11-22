import type { ControlCodec, Feature } from "#obsidian/feature.ts";
import { Effect } from "effect";

import type { SettingsKey } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

function codecOf(
  features: readonly Feature<any, any, any>[],
  key: string,
): ControlCodec | undefined {
  for (const feature of features)
    for (const codec of feature.settingTab.controls ?? [])
      if (codec.claims(key)) return codec;
  return undefined;
}

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

export function writeControlValue(
  features: readonly Feature<any, any, any>[],
  key: string,
  value: unknown,
) {
  const codec = codecOf(features, key);
  if (codec) return codec.write(key, value);
  return PluginSettings.use((settings) => settings.update({ [key]: value }));
}

export function settingCodec(
  claims: (key: string) => boolean,
  encode: (value: unknown) => string,
  decode: (value: unknown) => unknown,
): ControlCodec {
  return {
    claims,
    read: (key) =>
      PluginSettings.use((settings) => settings.current).pipe(
        Effect.map((current) => encode(current[key as SettingsKey])),
      ),
    write: (key, value) =>
      PluginSettings.use((settings) =>
        settings.update({ [key]: decode(value) }),
      ),
  };
}
