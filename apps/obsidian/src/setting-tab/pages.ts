// The setting rows this host still composes from several features, and the
// `obsidian://` handlers, as one feature of the host.
import { Effect, Layer } from "effect";

import type { ExcerptDisplays } from "@zotlit/annotations/desktop/excerpt-image/display.ts";
import type { CapabilityNotices } from "@zotlit/annotations/obsidian/annotation-repository/notices.ts";
import type { AnnotationRepository } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import type { ExcerptImageService } from "@zotlit/annotations/obsidian/excerpt-image/service.ts";
import type { CitationIndex } from "@zotlit/citations/obsidian/citation-index/service.ts";
import type { PandocEngine } from "@zotlit/citations/obsidian/pandoc/service.ts";
import type { Release } from "@zotlit/library-view/obsidian/release/service.ts";
import type { NoteFeature } from "@zotlit/notes/desktop/note-feature/service.ts";
import { createNoteImportView } from "@zotlit/notes/desktop/note-import/view.ts";
import { interactiveCreation } from "@zotlit/notes/desktop/profile/dialogs.ts";
import type { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import type { Template } from "@zotlit/notes/obsidian/template/service.ts";
import type { TemplateWorkbenchLauncher } from "@zotlit/notes/obsidian/template/workbench-launcher.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { WEB_WORKBENCH_ENABLED } from "@zotlit/plugin-kernel/constants.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import type { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { AttachmentImport } from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import type { ChineseSegmenter } from "@zotlit/plugin-services/obsidian/chinese-segmenter/service.ts";
import type { LanguagePack } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import type { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import type { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import type { SettingsKey } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import type { ZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";
import {
  defineFeature,
  registration,
} from "@zotlit/plugin-shell/obsidian/feature.ts";
import type { ControlCodec } from "@zotlit/plugin-shell/obsidian/feature.ts";
import type { Customize } from "@zotlit/template-workbench/desktop/local-bridge/customize.ts";
import type { LocalBridge } from "@zotlit/template-workbench/desktop/local-bridge/service.ts";
import type { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { layerProtocolHandlers } from "@/services/protocol/register.ts";

import {
  advancedPageItems,
  decodeLogLevel,
  encodeLogLevel,
  LOG_LEVEL_KEY,
} from "./advanced.ts";
import { citationsPageItems } from "./citations.ts";
import { literatureNoteItems, profilesPage } from "./profiles.ts";
import { resourcesGroup } from "./resources.ts";
import { AUTO_TRIM_KEYS, decodeAutoTrim, encodeAutoTrim } from "./templates.ts";
import { zoteroPageItems } from "./zotero.ts";

/** A `control` key whose stored value the dropdown shows through `encode` and `decode`. */
function settingCodec(
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

export const hostPages = defineFeature({
  name: "host pages",
  registrations: [
    registration(
      "ProtocolHandlers",
      Layer.unwrap(
        Effect.map(ObsidianApp, (app) => {
          const creation = interactiveCreation(app);
          return layerProtocolHandlers({
            ...creation,
            noteImportView: createNoteImportView(app, creation),
            webWorkbenchEnabled: WEB_WORKBENCH_ENABLED,
          });
        }),
      ),
    ),
  ],
  settingTab: {
    entries: {
      // Migration reminder (while pending) and the resources strip, one
      // headerless group — see resourcesGroup for why the reminder is
      // included structurally rather than via `visible`.
      resources: (ctx) => [resourcesGroup(ctx)],
      // The main page is the default Profile: its Literature Note rows
      // inline, no top-level heading (per Obsidian style) — see ADR 0036.
      "literature-notes": (ctx) => literatureNoteItems(ctx),
      profiles: (ctx) => [profilesPage(ctx)],
      citations: (ctx) => [
        {
          type: "page",
          id: "settings_page_citations",
          name: m.settings_page_citations(),
          desc: m.settings_page_citations_desc(),
          items: citationsPageItems(ctx),
        },
      ],
      zotero: (ctx) => [
        {
          type: "page",
          id: "settings_page_zotero",
          name: m.settings_page_zotero(),
          desc: m.settings_page_zotero_desc(),
          items: zoteroPageItems(ctx),
        },
      ],
      advanced: (ctx) => [
        {
          type: "page",
          id: "settings_page_advanced",
          name: m.settings_page_advanced(),
          desc: m.settings_page_advanced_desc(),
          items: advancedPageItems(ctx),
        },
      ],
    },
    controls: [
      // Auto-trim stores `false | "nl" | "slurp"`; its dropdown reads a string.
      settingCodec(
        (key) => AUTO_TRIM_KEYS.has(key as SettingsKey),
        encodeAutoTrim,
        decodeAutoTrim,
      ),
      // Log level stores `LogLevel | null`; its dropdown reads a string.
      settingCodec(
        (key) => key === LOG_LEVEL_KEY,
        encodeLogLevel,
        decodeLogLevel,
      ),
    ],
  },
});

// The services the rows this feature composes read.
declare module "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts" {
  interface SettingTabServiceRegistry {
    Profile: Profile;
    Template: Template;
    ZoteroPref: ZoteroPref;
    ZoteroReads: ZoteroReads;
    LibraryScope: LibraryScope;
    LocalServer: LocalServer;
    Release: Release;
    AnnotationRepository: AnnotationRepository;
    CapabilityNotices: CapabilityNotices;
    ZoteroLocalApi: ZoteroLocalApi;
    CitationIndex: CitationIndex;
    PandocEngine: PandocEngine;
    ChineseSegmenter: ChineseSegmenter;
    AttachmentImport: AttachmentImport;
    LocalBridge: LocalBridge;
    Customize: Customize;
    TemplateWorkbenchLauncher: TemplateWorkbenchLauncher;
    LanguagePack: LanguagePack;
    ExcerptImageService: ExcerptImageService;
    ExcerptDisplays: ExcerptDisplays;
    NoteFeature: NoteFeature;
    NoteIndex: NoteIndex;
  }
}
