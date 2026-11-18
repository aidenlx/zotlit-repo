// The notes, as far as they load on every Obsidian: the Templates, the
// Profiles' citation styles, the notes' settings, and their setting rows —
// the main page's Literature note rows, the Imported notes page, the Template
// engine group and the Citation text row. The desktop feature
// (`#desktop/feature.ts`) extends it with the Profiles, note creation and
// import, the template conversion and the note links.
import { Effect, Stream } from "effect";

import { citationsPageSlots } from "@zotlit/citations/obsidian/citation-index/settings-page.ts";
import { ProfileStyles } from "@zotlit/citations/obsidian/pandoc/profile-styles.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { SettingsKey } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import {
  defineFeature,
  registration,
  serviceGroup,
} from "@zotlit/plugin-shell/obsidian/feature.ts";
import { advancedPageSlots } from "@zotlit/plugin-shell/obsidian/setting-pages/advanced.ts";
import { settingCodec } from "@zotlit/plugin-shell/obsidian/setting-tab/controls.ts";

import { noteImportPageItems } from "./note-import/settings-page.ts";
import { literatureNoteItems } from "./profile/main-page-rows.ts";
import { layerProfileStyles } from "./profile/profile-styles.ts";
import { Profile } from "./profile/service.ts";
import {
  isProfileControlKey,
  profileControlValue,
  setProfileControlValue,
} from "./profile/setting-controls.ts";
import { profileSettings } from "./profile/settings.ts";
import { layerCitationTemplateActions } from "./template/actions.ts";
import { layerTemplate, Template } from "./template/service.ts";
import {
  AUTO_TRIM_KEYS,
  citationTextItems,
  decodeAutoTrim,
  encodeAutoTrim,
  templateEngineGroup,
} from "./template/settings-rows.ts";

import { noteImportSettings } from "#core/note-import/settings.ts";
import { templateSettings } from "#core/template/settings.ts";

export const notes = defineFeature({
  name: "notes",
  settings: [profileSettings, templateSettings, noteImportSettings],
  services: [
    serviceGroup(
      "Template",
      { provides: [Template], requires: [] },
      layerTemplate,
    ),
    // The citations read the Profiles through their port.
    serviceGroup(
      "ProfileStyles",
      { provides: [ProfileStyles], requires: [Profile] },
      layerProfileStyles,
    ),
  ],
  registrations: [
    registration("CitationTemplateActions", layerCitationTemplateActions),
  ],
  settingTab: {
    entries: {
      // The main page is the default Profile: its Literature Note rows
      // inline, no top-level heading (per Obsidian style) — see ADR 0036.
      "literature-notes": (ctx) => literatureNoteItems(ctx),
      "note-import": (ctx) => [
        {
          type: "page",
          id: "settings_page_note_import",
          name: m.settings_page_note_import(),
          desc: m.settings_page_note_import_desc(),
          items: noteImportPageItems(ctx),
        },
      ],
    },
    slots: {
      [advancedPageSlots.templateEngine]: (ctx) => [templateEngineGroup(ctx)],
      [citationsPageSlots.citationText]: (ctx) => citationTextItems(ctx),
    },
    controls: [
      {
        claims: isProfileControlKey,
        read: (key) => profileControlValue(key as never),
        write: (key, value) => setProfileControlValue(key as never, value),
      },
      // Auto-trim stores `false | "nl" | "slurp"`; its dropdown reads a string.
      settingCodec(
        (key) => AUTO_TRIM_KEYS.has(key as SettingsKey),
        encodeAutoTrim,
        decodeAutoTrim,
      ),
    ],
    rebuild: [
      Effect.map(Profile, (profile) => Stream.drop(profile.changes, 1)),
      Effect.map(Template, (template) => template.compileEvents),
      Effect.map(PluginSettings, (settings) =>
        settings.changes.pipe(
          Stream.map((current) => current["note.template-conversion-pending"]),
          Stream.changes,
          Stream.drop(1),
        ),
      ),
    ],
  },
  handles: ({ bridge, read }) => {
    const profile = read(Profile);
    return {
      template: read(Template),
      profile,
      // The Default Profile, as the Template Workbench opens it from a note.
      defaultProfile: {
        get defaultDocumentPath() {
          return bridge.runSync(profile.defaultDocumentPath);
        },
      },
    };
  },
});
