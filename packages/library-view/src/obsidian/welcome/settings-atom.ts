// The settings the Welcome View banner reads, shared by every leaf. Each key's
// default comes from the slice that owns it.
import { Effect, Stream } from "effect";

import { templateSettings } from "@zotlit/notes/core/template/settings.ts";
import { profileSettings } from "@zotlit/notes/obsidian/profile/settings.ts";
import { held } from "@zotlit/obsidian-kit/view-atoms.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { releaseSettings } from "#core/release/settings.ts";
import { welcomeSettings } from "#core/welcome/settings.ts";

const KEYS = [
  "welcome.dismissed",
  "welcome.requested",
  "welcome.steps-shown",
  "release.migration-pending",
  "release.update-pending",
  "release.notices-enabled",
  "note.template-conversion-pending",
  "note.template-conversion-result",
  "note.default-profile",
  "template.folder",
] as const;

/** The settings keys the banner reads. */
export type WelcomeSettings = Pick<Settings, (typeof KEYS)[number]>;

const pick = (settings: Readonly<WelcomeSettings>): WelcomeSettings =>
  Object.fromEntries(KEYS.map((key) => [key, settings[key]])) as never;

export const welcomeSettingsAtom = held(
  Stream.unwrap(
    Effect.map(PluginSettings, (settings) =>
      Stream.map(settings.changes, (current) => pick(current)),
    ),
  ),
  pick({
    ...welcomeSettings.defaults,
    ...releaseSettings.defaults,
    ...templateSettings.defaults,
    ...profileSettings.defaults,
  }),
);
