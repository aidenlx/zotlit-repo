// The declarative `control` rows' storage: every control key reads and writes
// the settings store, encoded for the control that shows it.
import { Effect } from "effect";

import {
  isProfileControlKey,
  profileControlValue,
  setProfileControlValue,
} from "@zotlit/notes/obsidian/profile/setting-controls.ts";
import type { ProfileControlKey } from "@zotlit/notes/obsidian/profile/setting-controls.ts";
import type { SettingsKey } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { decodeLogLevel, encodeLogLevel, LOG_LEVEL_KEY } from "./advanced.ts";
import { AUTO_TRIM_KEYS, decodeAutoTrim, encodeAutoTrim } from "./templates.ts";

/** The keys a declarative `control` of this tab binds: a settings key or a default Profile binding. */
export type SettingsControlKey = SettingsKey | ProfileControlKey;

/** A declarative `control`'s value, encoded for the control that shows it. */
export function controlValue(key: string) {
  if (isProfileControlKey(key)) return profileControlValue(key);
  return PluginSettings.use((settings) => settings.current).pipe(
    Effect.map((current) => {
      const value = current[key as SettingsKey];
      // Auto-trim stores `false | "nl" | "slurp"`; its dropdown reads a string.
      if (AUTO_TRIM_KEYS.has(key as SettingsKey)) return encodeAutoTrim(value);
      // Log level stores `LogLevel | null`; its dropdown reads a string.
      if (key === LOG_LEVEL_KEY) return encodeLogLevel(value);
      return value;
    }),
  );
}

/** Store a declarative `control`'s value, decoded from its control. */
export function writeControlValue(key: string, value: unknown) {
  if (isProfileControlKey(key)) return setProfileControlValue(key, value);
  const next = AUTO_TRIM_KEYS.has(key as SettingsKey)
    ? decodeAutoTrim(value)
    : key === LOG_LEVEL_KEY
      ? decodeLogLevel(value)
      : value;
  // `key` is constrained to schema keys by every `control` definition, and
  // `value` matches that key's control type, so the patch always validates.
  return PluginSettings.use((settings) => settings.update({ [key]: next }));
}
