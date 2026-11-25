import type { LiteratureNoteServices } from "#obsidian/attachment-open/literature-note.ts";
import { Effect, FileSystem, Layer } from "effect";

import { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { ViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { AttachmentResolver } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import {
  extendFeature,
  registration,
  serviceGroup,
} from "@zotlit/plugin-shell/obsidian/feature.ts";
import type { FeatureContext } from "@zotlit/plugin-shell/obsidian/feature.ts";
import { advancedPageSlots } from "@zotlit/plugin-shell/obsidian/setting-pages/advanced.ts";

import { addAttachmentOpenActions } from "./attachment-open/actions.ts";
import {
  openWithSystem,
  registerFileLinkCapture,
} from "./attachment-open/capture.ts";
import { attachmentLink } from "./attachment-open/link.ts";
import { attachmentOpenFileMenu } from "./attachment-open/menu.ts";
import {
  layerTargetOpener,
  PdfTargetReader,
  TargetOpener,
} from "./attachment-open/open-target.ts";
import { openTargetCommand } from "./attachment-open/view-opener.ts";
import { excerptCacheClearItem } from "./excerpt-image/clear-cache.ts";
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

import { bindLiteratureNoteAttachments } from "#obsidian/attachment-open/handle.ts";
import { ExcerptReaders } from "#obsidian/excerpt-image/reader-borrow.ts";
import { ExcerptImageService } from "#obsidian/excerpt-image/service.ts";
import { openExcerptStore } from "#obsidian/excerpt-image/store.ts";
import { annotations as obsidianAnnotations } from "#obsidian/feature.ts";
import { ReaderConnection } from "#obsidian/reader-connection/service.ts";

export const literatureNoteAttachmentsOf = ({
  bridge,
  read,
}: Pick<FeatureContext, "bridge" | "read">) =>
  bindLiteratureNoteAttachments(
    bridge,
    read(Effect.context<LiteratureNoteServices>()),
  );

const attachmentOpenDeps = (ctx: FeatureContext) => ({
  app: ctx.app,
  attachments: literatureNoteAttachmentsOf(ctx),
  opener: ctx.read(TargetOpener),
  bridge: ctx.bridge,
});

export const annotations = extendFeature(obsidianAnnotations, {
  services: [
    serviceGroup(
      "TargetOpener",
      {
        provides: [TargetOpener],
        requires: [PdfTargetReader, AttachmentResolver, VaultDisk],
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
        requires: [ExcerptReaders, FileSystem.FileSystem, ReaderConnection],
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
        requires: [
          ExcerptImageService,
          FileSystem.FileSystem,
          VaultDisk,
          ZoteroPref,
        ],
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
  ],
  registrations: [
    registration("AnnotationImageCli", layerAnnotationImageCli),
    registration("ExcerptRevalidation", layerExcerptRevalidation),
  ],
  protocol: [attachmentLink()],
  settingTab: {
    slots: {
      [advancedPageSlots.recovery]: (ctx) => [excerptCacheClearItem(ctx)],
    },
  },
  handles: (ctx) => {
    const { read } = ctx;
    return {
      excerptImage: read(ExcerptImageService),
      excerptDisplay: read(ExcerptDisplays),
      targetOpener: read(TargetOpener),
      literatureNoteAttachments: literatureNoteAttachmentsOf(ctx),
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
    stack.defer(read(ViewRegistry).mount(openTargetCommand));
    return { fileMenu: { "attachment-open": attachmentOpenFileMenu(deps) } };
  },
});
