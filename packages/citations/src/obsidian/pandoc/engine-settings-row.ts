// The settings row of the Pandoc engine: its status in the Resource Pack.

import type { SettingDefinition } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";
import { packBinaryDefinition } from "@zotlit/plugin-services/obsidian/managed-binary/pack-row.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

import { PandocEngine } from "./service.ts";

/** Where the source code of Pandoc is. */
const PANDOC_SOURCE = "https://github.com/jgm/pandoc";

/** The engine row, in the Pandoc engine's own words. */
export function pandocEngineDefinition(
  ctx: SettingTabContext,
): SettingDefinition<SettingsKey> {
  return packBinaryDefinition(ctx.tab, PandocEngine, {
    id: "settings_citation_engine",
    name: m.settings_citation_engine_name(),
    desc: m.settings_citation_engine_desc(),
    fallback: m.settings_citation_engine_fallback(),
    licence: {
      text: m.settings_citation_engine_licence(),
      source: { text: m.settings_citation_engine_source(), url: PANDOC_SOURCE },
    },
  });
}

// The services this file's rows read, in the setting tab's context.
declare module "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts" {
  interface SettingTabServiceRegistry {
    PandocEngine: PandocEngine;
  }
}
