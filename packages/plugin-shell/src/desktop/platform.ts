// The desktop half of the platform services: what reads Node — the Zotero
// preferences in `prefs.js`, the Local Server's listener, Attachment Import,
// the Zotero HTTP client over Node `http` and the Node file system.
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
import { layerLocalServer } from "@zotlit/plugin-services/desktop/local-server/layer.ts";
import {
  layerZoteroPref,
  layerZoteroPrefFiles,
} from "@zotlit/plugin-services/desktop/zotero-pref/layer.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import {
  defineFeature,
  registration,
  serviceGroup,
} from "#obsidian/feature.ts";

export const desktopPlatform = defineFeature({
  name: "desktop platform",
  services: [
    // The Node file system, once for the whole graph: the temp sweeps read
    // it, and so do the Profile dialogs that callers outside the graph open.
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
    rebuild: [
      // The Local server rows name the port the listener bound.
      Effect.map(LocalServer, (server) =>
        Stream.drop(server.effectivePortChanges, 1),
      ),
      // The Approved folders list names each grant.
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
    // The companion's Freshness Signal means the database changed and its
    // Checkpoint attempt has settled; feed it into the same coalesced refresh
    // lane as the filesystem watchers.
    stack.defer(
      bridge.subscribe(localServer.dbUpdated, () => {
        bridge.runAndForget(zoteroReads.notifyExternalChange);
      }),
    );
  },
});
