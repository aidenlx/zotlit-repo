import type { ObsidianOpenableAttachment } from "#core/attachment-open/resolve.ts";
import { Effect, Result } from "effect";
import type { Scope } from "effect";
import type { App, ObsidianProtocolData, PaneType } from "obsidian";

import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { libraryFilePaths } from "@zotlit/plugin-services/obsidian/library-source/paths.ts";
import {
  databaseReady,
  parseProtocolData,
} from "@zotlit/plugin-services/obsidian/protocol/link.ts";
import { showLinkOutcome } from "@zotlit/plugin-services/obsidian/protocol/notices.ts";
import { LinkOutcome } from "@zotlit/plugin-services/obsidian/protocol/outcome.ts";
import { protocolHandler } from "@zotlit/plugin-shell/obsidian/feature.ts";
import {
  openAttachmentProtocolActionId,
  parseOpenAttachmentProtocolQuery,
} from "@zotlit/protocol";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { openGesture, pdfPickerReader } from "./actions.ts";
import { openAttachments, withFixedPane } from "./open-attachments.ts";
import type { AttachmentReader } from "./open-attachments.ts";
import { TargetOpener } from "./open-target.ts";

import { toObsidianOpenable } from "#core/attachment-open/openable.ts";

export interface AttachmentLinkPorts {
  readonly app: App;
  readonly bridge: Pick<EffectBridge, "runAndForget">;
}

export const attachmentLinkPorts: Effect.Effect<
  AttachmentLinkPorts,
  never,
  ObsidianApp | Scope.Scope
> = Effect.gen(function* () {
  return { app: yield* ObsidianApp, bridge: yield* scopedBridge };
});

export function attachmentLink(
  ports: Effect.Effect<
    AttachmentLinkPorts,
    never,
    ObsidianApp | Scope.Scope
  > = attachmentLinkPorts,
) {
  return protocolHandler(openAttachmentProtocolActionId, (data) =>
    Effect.flatMap(ports, (deps) =>
      handleOpenAttachmentProtocol(data, deps).pipe(
        Effect.tap(showLinkOutcome),
      ),
    ),
  );
}

const handleOpenAttachmentProtocol = Effect.fn(
  "protocol.handleOpenAttachmentProtocol",
)(function* (data: ObsidianProtocolData, deps: AttachmentLinkPorts) {
  const action = "open-attachment";
  const parsed = yield* parseProtocolData(data, {
    action,
    parse: parseOpenAttachmentProtocolQuery,
  });
  if (Result.isFailure(parsed)) return parsed.failure;
  const query = parsed.success;

  const zoteroReads = yield* ZoteroReads;
  if (!(yield* databaseReady(zoteroReads, action)))
    return LinkOutcome.DatabaseUnavailable();

  const attachments = yield* zoteroReads.reads.AttachmentsAt({
    itemID: query.item,
  });

  const pdfs = toObsidianOpenable(attachments, {
    vaultBasePath: (yield* VaultDisk).basePath,
    platform: (yield* ObsidianEnv).os,
    zoteroPref: yield* libraryFilePaths,
  });

  openAttachments(pdfs.attachments, {
    reader: withPaneOverride(
      pdfPickerReader(
        openGesture(yield* TargetOpener, deps.bridge.runAndForget),
        pdfs,
      ),
      query.paneType,
    ),
    app: deps.app,
  });
  return LinkOutcome.Opened();
});

function withPaneOverride(
  reader: AttachmentReader<ObsidianOpenableAttachment>,
  paneType: PaneType | undefined,
): AttachmentReader<ObsidianOpenableAttachment> {
  return paneType ? withFixedPane(reader, paneType) : reader;
}
