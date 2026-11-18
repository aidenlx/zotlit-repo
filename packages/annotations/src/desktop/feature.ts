import type { LiteratureNoteServices } from "#obsidian/attachment-open/literature-note.ts";
// Reading and annotating as one feature a host composes: its services and
// the ports they read, its registrations, its reader settings, and what it
// registers at start-up.
import { Effect, FileSystem, Layer } from "effect";

import { revealSetting } from "@zotlit/obsidian-kit/open-settings.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { ViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { AttachmentResolver } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { ZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";
import {
  defineFeature,
  registration,
  serviceGroup,
} from "@zotlit/plugin-shell/obsidian/feature.ts";
import type { FeatureContext } from "@zotlit/plugin-shell/obsidian/feature.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { addAttachmentOpenActions } from "./attachment-open/actions.ts";
import {
  openWithSystem,
  registerFileLinkCapture,
} from "./attachment-open/capture.ts";
import { attachmentOpenFileMenu } from "./attachment-open/menu.ts";
import {
  layerTargetOpener,
  PdfTargetReader,
  TargetOpener,
} from "./attachment-open/open-target.ts";
import { openTargetCommand } from "./attachment-open/view-opener.ts";
import {
  ExcerptDisplays,
  layerExcerptDisplays,
} from "./excerpt-image/display.ts";
import { layerExcerptImages } from "./excerpt-image/layer.ts";
import {
  ExcerptPreparation,
  layerExcerptPreparation,
} from "./excerpt-image/prepare.ts";
import { layerAnnotationImageCli } from "./excerpt-image/register-cli.ts";
import { layerExcerptRevalidation } from "./excerpt-image/revalidation.ts";

import { blockedNotice } from "#obsidian/annot-view/card-verbs.ts";
import { AnnotationNoteActions } from "#obsidian/annot-view/note-actions.ts";
import { AnnotationViewReveal } from "#obsidian/annot-view/view-reveal.ts";
import { annotationHistoryFileMenu } from "#obsidian/annotation-repository/menu.ts";
import { bindCapabilityNotices } from "#obsidian/annotation-repository/notices-handle.ts";
import {
  CapabilityNotices,
  layerCapabilityNotices,
} from "#obsidian/annotation-repository/notices.ts";
import {
  AnnotationRepository,
  layerAnnotationRepository,
} from "#obsidian/annotation-repository/service.ts";
import { bindLiteratureNoteAttachments } from "#obsidian/attachment-open/handle.ts";
import {
  ExcerptReaders,
  layerExcerptReaders,
} from "#obsidian/excerpt-image/reader-borrow.ts";
import { ExcerptImageService } from "#obsidian/excerpt-image/service.ts";
import { openExcerptStore } from "#obsidian/excerpt-image/store.ts";
import {
  layerPdfAnnotationEditor,
  PdfAnnotationEditor,
} from "#obsidian/pdf-annotation-editor/service.ts";
import { readerPageItems } from "#obsidian/pdf-annotation-editor/settings-page.ts";
import { readerSettings } from "#obsidian/pdf-annotation-editor/settings.ts";

/** The Literature Note attachments a command or a view opens, over the built graph. */
export const literatureNoteAttachmentsOf = ({
  bridge,
  read,
}: Pick<FeatureContext, "bridge" | "read">) =>
  bindLiteratureNoteAttachments(
    bridge,
    read(Effect.context<LiteratureNoteServices>()),
  );

/** What the attachment-open commands and their file menu entry read. */
const attachmentOpenDeps = (ctx: FeatureContext) => ({
  app: ctx.app,
  attachments: literatureNoteAttachmentsOf(ctx),
  opener: ctx.read(TargetOpener),
  bridge: ctx.bridge,
});

export const annotations = defineFeature({
  name: "annotations",
  settings: [readerSettings],
  services: [
    serviceGroup(
      "ExcerptReaders",
      { provides: [ExcerptReaders] },
      layerExcerptReaders,
    ),
    // Every ZotLit gesture that opens an Attachment, and File Link Capture
    // for a link Obsidian rendered, decides through this one opener.
    serviceGroup(
      "TargetOpener",
      {
        provides: [TargetOpener],
        requires: [PdfTargetReader, AttachmentResolver],
      },
      layerTargetOpener({
        reader: PdfTargetReader,
        native: openWithSystem,
      }),
    ),
    serviceGroup(
      "ExcerptImages",
      {
        provides: [ExcerptImageService],
        requires: [ExcerptReaders, FileSystem.FileSystem],
      },
      Layer.unwrap(
        Effect.gen(function* () {
          const host = yield* PluginHost;
          const readers = yield* ExcerptReaders;
          return layerExcerptImages({
            openStore: () => openExcerptStore(host.app.appId),
            readers,
          });
        }),
      ),
    ),
    serviceGroup(
      "ExcerptPreparation",
      {
        provides: [ExcerptPreparation],
        requires: [ExcerptImageService, FileSystem.FileSystem, ZoteroPref],
      },
      layerExcerptPreparation,
    ),
    serviceGroup(
      "ExcerptDisplays",
      {
        provides: [ExcerptDisplays],
        requires: [ExcerptImageService, QueryClients],
      },
      layerExcerptDisplays,
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
    // An Annotation inserts into a note alike from the Annotation View and
    // from a mark dragged out of the PDF reader, so the reader builds above
    // the note actions.
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
  registrations: [
    registration("AnnotationImageCli", layerAnnotationImageCli),
    registration("ExcerptRevalidation", layerExcerptRevalidation),
  ],
  settingTab: { entries: { reader: () => [readerPage()] } },
  handles: (ctx) => {
    const { bridge, read } = ctx;
    return {
      excerptImage: read(ExcerptImageService),
      excerptDisplay: read(ExcerptDisplays),
      targetOpener: read(TargetOpener),
      literatureNoteAttachments: literatureNoteAttachmentsOf(ctx),
      annotationRepository: read(AnnotationRepository),
      capabilityNotices: bindCapabilityNotices(bridge, read(CapabilityNotices)),
      pdfAnnotationEditor: read(PdfAnnotationEditor),
    };
  },
  onload: (ctx) => {
    const { plugin, bridge, read, stack } = ctx;
    const deps = attachmentOpenDeps(ctx);
    addAttachmentOpenActions(plugin, deps);
    void stack.use(
      registerFileLinkCapture({
        opener: read(TargetOpener),
        attachments: read(AttachmentResolver),
        settings: read(PluginSettings),
        bridge,
      }),
    );
    // A view's open outlives the tab that started it: the reader may
    // replace that tab.
    stack.defer(read(ViewRegistry).mount(openTargetCommand));
    const annotationRepository = read(AnnotationRepository);
    const pdfAnnotationEditor = read(PdfAnnotationEditor);
    return {
      fileMenu: {
        "attachment-open": attachmentOpenFileMenu(deps),
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

/** The Reader page. */
function readerPage() {
  return {
    type: "page" as const,
    id: "settings_page_reader",
    name: m.settings_page_reader(),
    desc: m.settings_page_reader_desc(),
    items: readerPageItems(),
  };
}
