import type { ObsidianOpenableAttachment } from "#core/attachment-open/resolve.ts";
// `obsidian://zotlit/open-attachment`: the link that opens an Item's
// Attachments, or the Attachment it names, from Zotero.
import { Effect, Result } from "effect";
import type { Scope } from "effect";
import type { App, ObsidianProtocolData, PaneType } from "obsidian";

import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
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

/** The legacy values the link still holds. */
export interface AttachmentLinkPorts {
  readonly app: App;
  /** Runs the Attachment picker's opens, which unload interrupts. */
  readonly bridge: Pick<EffectBridge, "runAndForget">;
}

/** The App, and a bridge over the plugin's Scope. */
export const attachmentLinkPorts: Effect.Effect<
  AttachmentLinkPorts,
  never,
  ObsidianApp | Scope.Scope
> = Effect.gen(function* () {
  return { app: yield* ObsidianApp, bridge: yield* scopedBridge };
});

/** The `open-attachment` link, running with the ports `ports` makes. */
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

/**
 * Handle `obsidian://zotlit/open-attachment`. `query.item` may name either a
 * regular Item or an Attachment directly — `resolveProtocolItem` assumes a
 * regular item, so this branches for itself instead.
 */
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

  const openable = toObsidianOpenable(attachments, {
    vaultBasePath: (yield* ObsidianEnv).basePath,
    zoteroPref: yield* (yield* ZoteroPref).current,
  });

  openAttachments(openable, {
    reader: withPaneOverride(
      pdfPickerReader(
        openGesture(yield* TargetOpener, deps.bridge.runAndForget),
      ),
      query.paneType,
    ),
    app: deps.app,
  });
  return LinkOutcome.Opened();
});

/**
 * The Suggest modal's own click decides the pane (Mod-click/Mod-Enter) when
 * the link names none; a named `paneType` wins outright, since the link's own
 * request should not be second-guessed by how the picker was clicked.
 */
function withPaneOverride(
  reader: AttachmentReader<ObsidianOpenableAttachment>,
  paneType: PaneType | undefined,
): AttachmentReader<ObsidianOpenableAttachment> {
  return paneType ? withFixedPane(reader, paneType) : reader;
}
