import { Effect, Stream } from "effect";

import { logSettings } from "@zotlit/plugin-services/core/log/settings.ts";
import { layerLanguagePackNotices } from "@zotlit/plugin-services/obsidian/language-pack/notices.ts";
import { LanguagePack } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import {
  decodeLogLevel,
  encodeLogLevel,
  LOG_LEVEL_KEY,
} from "@zotlit/plugin-services/obsidian/log/settings-rows.ts";

import { defineFeature, registration } from "./feature.ts";
import { advancedPage } from "./setting-pages/advanced.ts";
import { settingCodec } from "./setting-tab/controls.ts";

export const platformBase = defineFeature({
  name: "platform",
  settings: [logSettings],
  registrations: [
    registration("LanguagePackNotices", layerLanguagePackNotices),
  ],
  settingTab: {
    entries: {
      advanced: (ctx) => [advancedPage(ctx)],
    },
    controls: [
      settingCodec(
        (key) => key === LOG_LEVEL_KEY,
        encodeLogLevel,
        decodeLogLevel,
      ),
    ],
    rebuild: [Effect.map(LanguagePack, (pack) => Stream.drop(pack.changes, 1))],
  },
});
