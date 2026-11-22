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
      defaultProfile: {
        get defaultDocumentPath() {
          return bridge.runSync(profile.defaultDocumentPath);
        },
      },
    };
  },
});
