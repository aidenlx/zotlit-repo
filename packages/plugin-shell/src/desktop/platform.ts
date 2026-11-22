import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, FileSystem, Layer, Stream } from "effect";

import { layerZoteroHttpNode } from "@zotlit/obsidian-desktop/zotero-http-node.ts";
import { openSettingsTab } from "@zotlit/obsidian-kit/open-settings.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { ZoteroHttp } from "@zotlit/plugin-kernel/zotero-http.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { layerAttachmentSkipNotice } from "@zotlit/plugin-services/desktop/attachment-import/notices.ts";
import {
  AttachmentImport,
  layerAttachmentImport,
} from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import { attachmentPageItems } from "@zotlit/plugin-services/desktop/attachment-import/settings-page.ts";
import {
  databaseFileItem,
  databaseLocationItems,
  databaseSyncItems,
} from "@zotlit/plugin-services/desktop/database/settings-rows.ts";
import { layerLocalServer } from "@zotlit/plugin-services/desktop/local-server/layer.ts";
import { openLogFileItem } from "@zotlit/plugin-services/desktop/log/open-file.ts";
import {
  layerZoteroPref,
  layerZoteroPrefFiles,
} from "@zotlit/plugin-services/desktop/zotero-pref/layer.ts";
import { liveUpdatesItems } from "@zotlit/plugin-services/obsidian/local-server/settings-rows.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import {
  defineFeature,
  registration,
  serviceGroup,
} from "#obsidian/feature.ts";
import { zoteroPageSlots } from "#obsidian/setting-pages/zotero.ts";

export const desktopPlatform = defineFeature({
  name: "desktop platform",
  services: [
    serviceGroup(
      "FileSystem",
      { provides: [FileSystem.FileSystem] },
      NodeFileSystem.layer,
    ),
    serviceGroup(
      "ZoteroPref",
      { provides: [ZoteroPref], requires: [FileSystem.FileSystem] },
      layerZoteroPref.pipe(Layer.provide(layerZoteroPrefFiles)),
    ),
    serviceGroup("ZoteroHttp", { provides: [ZoteroHttp] }, layerZoteroHttpNode),
    serviceGroup(
      "LocalServer",
      { provides: [LocalServer], requires: [ZoteroPref, NoteIndex] },
      layerLocalServer,
    ),
    serviceGroup(
      "AttachmentImport",
      {
        provides: [AttachmentImport],
        requires: [FileSystem.FileSystem, ZoteroPref],
      },
      layerAttachmentImport(),
    ),
  ],
  registrations: [
    registration(
      "AttachmentSkipNotice",
      Layer.unwrap(
        Effect.gen(function* () {
          const host = yield* PluginHost;
          return layerAttachmentSkipNotice({
            openSettings: () => {
              openSettingsTab(host.app, host.manifest.id, [
                "settings_page_attachments",
                "settings_attachment_approved",
              ]);
            },
          });
        }),
      ),
    ),
  ],
  settingTab: {
    entries: {
      attachments: (ctx) => [
        {
          type: "page",
          id: "settings_page_attachments",
          name: m.settings_page_attachments(),
          desc: m.settings_page_attachments_desc(),
          items: attachmentPageItems(ctx),
        },
      ],
    },
    slots: {
      [zoteroPageSlots.database]: (ctx) => [
        {
          type: "group",
          id: "settings_zotero_database",
          items: [
            databaseFileItem(ctx),
            {
              type: "page",
              id: "settings_page_zotero_location",
              name: m.settings_page_zotero_location(),
              desc: m.settings_page_zotero_location_desc(),
              items: databaseLocationItems(ctx),
            },
          ],
        },
      ],
      [zoteroPageSlots.sync]: (ctx) => [
        {
          type: "group",
          id: "settings_zotero_sync",
          heading: m.settings_zotero_sync_heading(),
          items: databaseSyncItems(liveUpdatesItems(ctx)),
        },
      ],
      "advanced.log-file": (ctx) => [openLogFileItem(ctx)],
    },
    rebuild: [
      Effect.map(LocalServer, (server) =>
        Stream.drop(server.effectivePortChanges, 1),
      ),
      Effect.map(AttachmentImport, (attachments) =>
        Stream.drop(attachments.approvedFoldersChanges, 1),
      ),
    ],
  },
  handles: ({ read }) => ({
    zoteroPref: read(ZoteroPref),
    localServer: read(LocalServer),
    fileSystem: read(FileSystem.FileSystem),
  }),
  onload: ({ bridge, read, stack }) => {
    const localServer = read(LocalServer);
    const zoteroReads = read(ZoteroReads);
    stack.defer(
      bridge.subscribe(localServer.dbUpdated, () => {
        bridge.runAndForget(zoteroReads.notifyExternalChange);
      }),
    );
  },
});
