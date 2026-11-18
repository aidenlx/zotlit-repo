// The main page's Literature note rows: the default Profile's note folders,
// then its citation style and its document, which the desktop notes and the
// Template Workbench give through the page's slots. No heading names the
// default Profile here — the Profiles page does (ADR 0036).
import type { SettingDefinitionItem } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

import type { ResolvedLiteratureNoteProfileBindings } from "./bindings.ts";
import { profileControlKey } from "./setting-controls.ts";
import type { ProfileControlKey } from "./setting-controls.ts";
import { profileSettings } from "./settings.ts";

declare module "@zotlit/plugin-services/obsidian/setting-tab/context.ts" {
  interface SettingTabSlots {
    /** The main page, under the note folders: the default Profile's citation style. */
    "literature-notes.citation-style": unknown;
    /** The main page's last Literature note row: the default Profile's document. */
    "literature-notes.document": unknown;
  }
}

/** The slots the main page's Literature note rows hold. */
export const literatureNoteSlots = {
  citationStyle: "literature-notes.citation-style",
  document: "literature-notes.document",
} as const;

/** The keys a declarative `control` of these rows binds: a settings key or a default Profile binding. */
export type SettingsControlKey = SettingsKey | ProfileControlKey;

/** Default Profile binding value for a nested declarative control. */
function defaultBinding(
  key: keyof ResolvedLiteratureNoteProfileBindings,
): string {
  return String(profileSettings.defaults["note.default-profile"].bindings[key]);
}

/**
 * The main-page rows of the default Profile: both note folders it binds, then
 * its citation style and document. Its other Imported Note bindings sit on the
 * Imported notes page.
 */
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
