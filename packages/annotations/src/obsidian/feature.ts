import { Effect, Layer } from "effect";

import { revealSetting } from "@zotlit/obsidian-kit/open-settings.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { AttachmentResolver } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import type { SettingTabContext } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { ZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";
import {
  defineFeature,
  serviceGroup,
} from "@zotlit/plugin-shell/obsidian/feature.ts";
import { zoteroPageSlots } from "@zotlit/plugin-shell/obsidian/setting-pages/zotero.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { blockedNotice } from "./annot-view/card-verbs.ts";
import { AnnotationNoteActions } from "./annot-view/note-actions.ts";
import { AnnotationViewReveal } from "./annot-view/view-reveal.ts";
import { zoteroEditingRow } from "./annotation-repository/editing-settings-row.ts";
import { annotationHistoryFileMenu } from "./annotation-repository/menu.ts";
import { bindCapabilityNotices } from "./annotation-repository/notices-handle.ts";
import {
  CapabilityNotices,
  layerCapabilityNotices,
} from "./annotation-repository/notices.ts";
import {
  AnnotationRepository,
  layerAnnotationRepository,
} from "./annotation-repository/service.ts";
import {
  ExcerptReaders,
  layerExcerptReaders,
} from "./excerpt-image/reader-borrow.ts";
import { ExcerptImageService } from "./excerpt-image/service.ts";
import {
  layerPdfAnnotationEditor,
  PdfAnnotationEditor,
} from "./pdf-annotation-editor/service.ts";
import { readerPageItems } from "./pdf-annotation-editor/settings-page.ts";
import { readerSettings } from "./pdf-annotation-editor/settings.ts";
import { layerZotlitPdfReader, ZotlitPdfReader } from "./pdf-reader/service.ts";
import { readerHandshake } from "./reader-connection/handshake.ts";
import {
  layerReaderConnection,
  ReaderConnection,
} from "./reader-connection/service.ts";

export const annotations = defineFeature({
  name: "annotations",
  settings: [readerSettings],
  services: [
    serviceGroup(
      "ReaderConnection",
      { provides: [ReaderConnection] },
      Layer.unwrap(
        Effect.gen(function* () {
          const host = yield* PluginHost;
          return layerReaderConnection(
            readerHandshake(host.app, host.manifest.id),
          );
        }),
      ),
    ),
    serviceGroup(
      "ZotlitPdfReader",
      {
        provides: [ZotlitPdfReader],
        requires: [ReaderConnection, AttachmentResolver],
      },
      layerZotlitPdfReader,
    ),
    serviceGroup(
      "ExcerptReaders",
      { provides: [ExcerptReaders] },
      layerExcerptReaders,
    ),
    serviceGroup(
      "AnnotationRepository",
      {
        provides: [AnnotationRepository],
        requires: [
          ExcerptImageService,
          ZoteroReads,
          QueryClients,
          ZoteroLocalApi,
          ZoteroPref,
        ],
      },
      layerAnnotationRepository({}),
    ),
    serviceGroup(
      "CapabilityNotices",
      {
        provides: [CapabilityNotices],
        requires: [AnnotationRepository, ZoteroLocalApi, AnnotationViewReveal],
      },
      Layer.unwrap(
        Effect.gen(function* () {
          const host = yield* PluginHost;
          const view = yield* AnnotationViewReveal;
          return layerCapabilityNotices({
            openEditingSettings: () =>
              revealSetting(
                host.app,
                host.manifest.id,
                "settings_zotero_editing",
              ),
            cardShown: view.cardShown,
            revealAnnotation: view.revealAnnotation,
          });
        }),
      ),
    ),
    serviceGroup(
      "PdfAnnotationEditor",
      {
        provides: [PdfAnnotationEditor],
        requires: [
          AnnotationNoteActions,
          AnnotationViewReveal,
          ExcerptReaders,
          AnnotationRepository,
          AttachmentResolver,
          CapabilityNotices,
          NoteIndex,
          ReaderConnection,
          UseLedger,
          ZoteroLocalApi,
          ZoteroPref,
          ZoteroReads,
        ],
      },
      Layer.unwrap(
        Effect.gen(function* () {
          const view = yield* AnnotationViewReveal;
          const readers = yield* ExcerptReaders;
          return layerPdfAnnotationEditor({
            revealAnnotation: view.revealAnnotation,
            blockedPress: blockedNotice,
            readers,
          });
        }),
      ),
    ),
  ],
  settingTab: {
    entries: { reader: (ctx) => [readerPage(ctx)] },
    slots: {
      [zoteroPageSlots.editing]: (ctx) => [
        {
          type: "group",
          id: "settings_zotero_editing_group",
          heading: m.settings_zotero_editing_heading(),
          items: [zoteroEditingRow(ctx)],
        },
      ],
    },
  },
  handles: ({ bridge, read }) => ({
    annotationRepository: read(AnnotationRepository),
    capabilityNotices: bindCapabilityNotices(bridge, read(CapabilityNotices)),
    pdfAnnotationEditor: read(PdfAnnotationEditor),
    pdfReader: read(ZotlitPdfReader),
  }),
  onload: ({ bridge, read }) => {
    const annotationRepository = read(AnnotationRepository);
    const pdfAnnotationEditor = read(PdfAnnotationEditor);
    return {
      fileMenu: {
        "annotation-history": annotationHistoryFileMenu({
          annotations: annotationRepository,
          bridge,
          surfaceFor: (leaf) =>
            bridge.runSync(pdfAnnotationEditor.bindingFor(leaf.view)),
        }),
      },
    };
  },
});

function readerPage(ctx: SettingTabContext) {
  return {
    type: "page" as const,
    id: "settings_page_reader",
    name: m.settings_page_reader(),
    desc: m.settings_page_reader_desc(),
    items: readerPageItems(ctx),
  };
}
