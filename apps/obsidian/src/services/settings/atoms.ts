// View atoms over the plugin settings, shared by every leaf.
import { Effect, Stream } from "effect";

import { held } from "@zotlit/obsidian-kit/view-atoms.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { defaults } from "./schema.ts";

export const settingsAtom = held(
  Stream.unwrap(Effect.map(PluginSettings, (settings) => settings.changes)),
  defaults,
);
