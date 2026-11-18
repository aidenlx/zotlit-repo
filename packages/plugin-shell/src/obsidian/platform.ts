// The platform services as a feature every host composes: what of
// `@zotlit/plugin-services` loads on every Obsidian, and the ports it reads
// that a host's platform fills (the Zotero preferences, the Local Server, the
// Zotero HTTP client, ZoteroReads).
import { Effect, Layer, Stream } from "effect";

import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { ZoteroHttp } from "@zotlit/plugin-kernel/zotero-http.ts";
import { attachmentSettings } from "@zotlit/plugin-services/core/attachment-import/settings.ts";
import { databaseSettings } from "@zotlit/plugin-services/core/database/settings.ts";
import { itemLookupSettings } from "@zotlit/plugin-services/core/item-lookup/settings.ts";
import { libraryScopeSettings } from "@zotlit/plugin-services/core/library-scope/settings.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import { serverSettings } from "@zotlit/plugin-services/core/local-server/settings.ts";
import { logSettings } from "@zotlit/plugin-services/core/log/settings.ts";
import {
  layerQueryClients,
  QueryClients,
} from "@zotlit/plugin-services/core/query-client/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import {
  AttachmentResolver,
  layerAttachmentResolver,
} from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";
import {
  ChineseSegmenter,
  layerChineseSegmenter,
} from "@zotlit/plugin-services/obsidian/chinese-segmenter/service.ts";
import { layerDatabaseActions } from "@zotlit/plugin-services/obsidian/database/actions.ts";
import { libraryTagNamesOf } from "@zotlit/plugin-services/obsidian/database/library-tag-names.ts";
import { addIndexedKeyActions } from "@zotlit/plugin-services/obsidian/indexed-key/actions.ts";
import { indexedKeyFileMenu } from "@zotlit/plugin-services/obsidian/indexed-key/menu.ts";
import { bindItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/handle.ts";
import {
  ItemLookup,
  layerItemLookup,
} from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import { layerLanguagePackNotices } from "@zotlit/plugin-services/obsidian/language-pack/notices.ts";
import { LanguagePack } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import { layerLibraryScopeCli } from "@zotlit/plugin-services/obsidian/library-scope/cli.ts";
import { layerLibraryScopeNotices } from "@zotlit/plugin-services/obsidian/library-scope/notices.ts";
import {
  layerLibraryScope,
  LibraryScope,
  scopeChanges,
} from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import {
  decodeLogLevel,
  encodeLogLevel,
  LOG_LEVEL_KEY,
} from "@zotlit/plugin-services/obsidian/log/settings-rows.ts";
import { bindManagedBinary } from "@zotlit/plugin-services/obsidian/managed-binary/handle.ts";
import { layerManagedBinaryPlatform } from "@zotlit/plugin-services/obsidian/managed-binary/service.ts";
import {
  layerNoteIndex,
  NoteIndex,
} from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import {
  layerUseLedger,
  UseLedger,
} from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import {
  layerZoteroLocalApi,
  ZoteroLocalApi,
} from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";
import { SecretWriteAuthorizationStore } from "@zotlit/plugin-services/obsidian/zotero-local-api/write-authorization.ts";
import { acquireReadLease } from "@zotlit/zotero-reads/client/lease.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { defineFeature, registration, serviceGroup } from "./feature.ts";
import { advancedPage } from "./setting-pages/advanced.ts";
import { zoteroPage } from "./setting-pages/zotero.ts";
import { settingCodec } from "./setting-tab/controls.ts";

export const platform = defineFeature({
  name: "platform",
  settings: [
    logSettings,
    itemLookupSettings,
    serverSettings,
    databaseSettings,
    libraryScopeSettings,
    attachmentSettings,
  ],
  services: [
    serviceGroup("UseLedger", { provides: [UseLedger] }, layerUseLedger),
    serviceGroup(
      "ChineseSegmenter",
      { provides: [ChineseSegmenter] },
      layerChineseSegmenter.pipe(Layer.provide(layerManagedBinaryPlatform)),
    ),
    serviceGroup("NoteIndex", { provides: [NoteIndex] }, layerNoteIndex),
    serviceGroup(
      "QueryClients",
      { provides: [QueryClients] },
      layerQueryClients,
    ),
    serviceGroup(
      "ZoteroLocalApi",
      {
        provides: [ZoteroLocalApi],
        requires: [ZoteroPref, LocalServer, ZoteroHttp],
      },
      // The Remembered Write Authorization lives in Obsidian's Keychain,
      // where the user can see and delete it — never in synced settings.
      Layer.unwrap(
        Effect.gen(function* () {
          const app = yield* ObsidianApp;
          return layerZoteroLocalApi({
            credentials: new SecretWriteAuthorizationStore({
              secrets: app.secretStorage,
            }),
          });
        }),
      ),
    ),
    serviceGroup(
      "LibraryScope",
      { provides: [LibraryScope], requires: [ZoteroReads, QueryClients] },
      layerLibraryScope,
    ),
    serviceGroup(
      "AttachmentResolver",
      {
        provides: [AttachmentResolver],
        requires: [QueryClients, ZoteroPref, ZoteroReads],
      },
      layerAttachmentResolver(),
    ),
    serviceGroup(
      "ItemLookup",
      {
        provides: [ItemLookup],
        requires: [ZoteroReads, LibraryScope, UseLedger],
      },
      layerItemLookup,
    ),
  ],
  registrations: [
    registration("DatabaseActions", layerDatabaseActions),
    registration("LanguagePackNotices", layerLanguagePackNotices),
    registration("LibraryScopeCli", layerLibraryScopeCli),
    registration("LibraryScopeNotices", layerLibraryScopeNotices),
  ],
  settingTab: {
    entries: {
      zotero: (ctx) => [zoteroPage(ctx)],
      advanced: (ctx) => [advancedPage(ctx)],
    },
    controls: [
      // Log level stores `LogLevel | null`; its dropdown reads a string.
      settingCodec(
        (key) => key === LOG_LEVEL_KEY,
        encodeLogLevel,
        decodeLogLevel,
      ),
    ],
    rebuild: [
      // The Language Pack row stands only while a pack is offered.
      Effect.map(LanguagePack, (pack) => Stream.drop(pack.changes, 1)),
      Effect.map(ChineseSegmenter, (segmenter) =>
        Stream.drop(segmenter.changes, 1),
      ),
      // A database refresh, a group rename, or a repair moves the scope.
      Effect.map(LibraryScope, (scope) => scopeChanges(scope.changes)),
    ],
  },
  handles: ({ bridge, read }) => {
    const zoteroReads = read(ZoteroReads);
    return {
      useLedger: read(UseLedger),
      queryClient: read(QueryClients),
      noteIndex: read(NoteIndex),
      chineseSegmenter: bindManagedBinary(bridge, read(ChineseSegmenter)),
      zoteroReads,
      acquireZoteroRead: () => acquireReadLease(zoteroReads, bridge),
      libraryTagNames: libraryTagNamesOf(zoteroReads, bridge),
      attachmentResolver: read(AttachmentResolver),
      zoteroLocalApi: read(ZoteroLocalApi),
      libraryScope: read(LibraryScope),
      itemLookup: bindItemLookup(bridge, read(ItemLookup)),
    };
  },
  onload: ({ plugin }) => {
    addIndexedKeyActions(plugin);
    return { fileMenu: { "indexed-key": indexedKeyFileMenu() } };
  },
});
