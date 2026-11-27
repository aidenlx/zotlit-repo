import type { SettingDefinitionItem } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

import type { ResolvedLiteratureNoteProfileBindings } from "./bindings.ts";
import type { ProfileControlKey } from "./setting-controls.ts";
import { profileControlKey } from "./setting-controls.ts";
import { profileSettings } from "./settings.ts";

declare module "@zotlit/plugin-services/obsidian/setting-tab/context.ts" {
  interface SettingTabSlots {
    "literature-notes.citation-style": unknown;
    "literature-notes.document": unknown;
  }
}

export const literatureNoteSlots = {
  citationStyle: "literature-notes.citation-style",
  document: "literature-notes.document",
} as const;

export type SettingsControlKey = SettingsKey | ProfileControlKey;

function defaultBinding(
  key: keyof ResolvedLiteratureNoteProfileBindings,
): string {
  return String(profileSettings.defaults["note.default-profile"].bindings[key]);
}

export function literatureNoteItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsControlKey>[] {
  return [
    {
      id: "settings_profile_folder",
      name: m.settings_profile_folder_name(),
      desc: m.settings_note_folder_desc(),
      control: {
        type: "folder",
        key: profileControlKey("default", "folder"),
        placeholder: defaultBinding("note.literature-folder"),
      },
    },
    {
      id: "settings_note_import_folder",
      name: m.settings_note_import_folder_name(),
      desc: m.settings_note_import_folder_desc(),
      control: {
        type: "folder",
        key: profileControlKey("default", "import-folder"),
        placeholder: defaultBinding("note.import-folder"),
      },
    },
    ...ctx.slot(literatureNoteSlots.citationStyle),
    ...ctx.slot(literatureNoteSlots.document),
  ];
}
