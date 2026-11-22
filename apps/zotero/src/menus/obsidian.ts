import {
  buildBatchProtocolUrl,
  buildExploreProtocolUrl,
  buildImportAllNotesProtocolUrl,
  buildImportManyProtocolUrl,
  buildImportProtocolUrl,
  buildOpenAttachmentProtocolUrl,
  buildProtocolUrl,
  buildUpdateAllProtocolUrl,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
} from "@zotlit/protocol";
import type {
  BatchUpdateRequest,
  ImportMode,
  ImportNotesRequest,
  ProtocolAction,
  UpdateScope,
} from "@zotlit/protocol";

import { formatValue } from "@/lib/l10n.ts";
import type { FluentMessageArgs } from "@/lib/l10n.ts";
import { launchExternalUrl } from "@/lib/launch-url.ts";
import { logger as appLogger } from "@/lib/logger.ts";
import { notifyUrl } from "@/notify/shared.ts";
import { sourceId } from "@/notify/source.ts";
import { preferredPaneType } from "@/prefs/pane-type.ts";
import type { FluentMessageId, FluentMessages } from "@/types/fluent.ts";

const logger = appLogger.getChild(["menus", "obsidian"]);

const URL_LENGTH_CAP = 2000;

export function openInObsidian(
  action: ProtocolAction,
  item: Zotero.Item,
  scope?: UpdateScope,
): void {
  const url = buildProtocolUrl(action, item.id, {
    sourceId: sourceId(),
    scope,
    paneType: preferredPaneType(),
  });
  logger.info("opening obsidian", { action, itemID: item.id, scope, url });
  launchExternalUrl(url);
}

export function openAttachmentInObsidian(item: Zotero.Item): void {
  const url = buildOpenAttachmentProtocolUrl(item.id, {
    sourceId: sourceId(),
    paneType: preferredPaneType(),
  });
  logger.info("opening obsidian (open-attachment)", { itemID: item.id, url });
  launchExternalUrl(url);
}

export function exploreInObsidian(
  item: Zotero.Item,
  annotation?: string,
): void {
  const url = buildExploreProtocolUrl(item.id, {
    sourceId: sourceId(),
    annotation,
    paneType: preferredPaneType(),
  });
  logger.info("opening obsidian (explore)", {
    itemID: item.id,
    annotation,
    url,
  });
  launchExternalUrl(url);
}

export function updateAllInObsidian(
  groupID: number,
  collectionKey?: string,
): void {
  const url = buildUpdateAllProtocolUrl(sourceId(), groupID, collectionKey);
  logger.info("opening obsidian (update-all)", { groupID, collectionKey, url });
  launchExternalUrl(url);
}

export function importAllNotesInObsidian(
  groupID: number,
  collectionKey?: string,
): void {
  const url = buildImportAllNotesProtocolUrl(
    sourceId(),
    groupID,
    collectionKey,
  );
  logger.info("opening obsidian (import-all-notes)", {
    groupID,
    collectionKey,
    url,
  });
  launchExternalUrl(url);
}

interface ListenerMessages {
  sendingTitleId: FluentMessageId;
  sentTitleId: FluentMessageId;
  sentMessageId: FluentMessageId;
  failedTitleId: FluentMessageId;
  failedMessageId: FluentMessageId;
}

async function launchOrPut(
  url: string,
  {
    label,
    path,
    body,
    count,
    messages,
  }: {
    label: string;
    path: string;
    body: unknown;
    count: number;
    messages: ListenerMessages;
  },
): Promise<void> {
  if (url.length <= URL_LENGTH_CAP) {
    logger.info(`opening obsidian (${label} link)`, {
      count,
      length: url.length,
    });
    launchExternalUrl(url);
    return;
  }

  logger.info(`${label} link over cap, putting listener`, {
    count,
    length: url.length,
  });

  const base = notifyUrl();
  if (!base) {
    logger.warn(`no notify URL for ${label} fallback`);
    await showServerHint();
    return;
  }

  const progress = new Zotero.ProgressWindow({
    window: Zotero.getMainWindow(),
  });
  progress.changeHeadline((await formatValue(messages.sendingTitleId)) ?? "");
  progress.show();

  try {
    const response = await fetch(new URL(path, base), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
        [SOURCE_ID_HEADER]: sourceId(),
      },
      body: JSON.stringify(body),
    });
    if (response.status === 426) {
      logger.warn("obsidian rejected protocol version", { base });
      await settleProtocolMismatch(progress);
      return;
    }
    if (!response.ok) {
      throw new Error(`PUT ${path} failed: ${response.status}`);
    }
    logger.info(`sent ${label}`, { base, count });
    await settleProgress(progress, {
      titleId: messages.sentTitleId,
      messageId: messages.sentMessageId,
      messageArgs: { count },
    });
  } catch (error) {
    logger.warn(`failed to send ${label}`, { base, error });
    await settleProgress(progress, {
      titleId: messages.failedTitleId,
      messageId: messages.failedMessageId,
    });
  }
}

export async function updateManyInObsidian(
  items: readonly Zotero.Item[],
  scope?: UpdateScope,
): Promise<void> {
  const itemIDs = items.map((item) => item.id);
  const url = buildBatchProtocolUrl(itemIDs, { sourceId: sourceId(), scope });

  await launchOrPut(url, {
    label: "batch update",
    path: "/literature-notes",
    body: { items: itemIDs, scope } satisfies BatchUpdateRequest,
    count: itemIDs.length,
    messages: {
      sendingTitleId: "zotlit-batch-update-sending-title",
      sentTitleId: "zotlit-batch-update-sent-title",
      sentMessageId: "zotlit-batch-update-sent-message",
      failedTitleId: "zotlit-batch-update-failed-title",
      failedMessageId: "zotlit-batch-update-failed-message",
    },
  });
}

async function settleProgress<M extends FluentMessageId>(
  progress: Zotero.ProgressWindow,
  {
    titleId,
    messageId,
    messageArgs,
  }: {
    titleId: FluentMessageId;
    messageId: M;
    messageArgs?: FluentMessages[M];
  },
): Promise<void> {
  const [title, message] = await Promise.all([
    formatValue(titleId),
    formatValue(messageId, ...([messageArgs] as FluentMessageArgs<M>)),
  ]);
  progress.changeHeadline(title ?? "");
  progress.addDescription(message ?? "");
  progress.startCloseTimer(8000);
}

async function settleProtocolMismatch(
  progress: Zotero.ProgressWindow,
): Promise<void> {
  await settleProgress(progress, {
    titleId: "zotlit-protocol-incompatible-title",
    messageId: "zotlit-protocol-incompatible-message",
  });
}

async function showServerHint(): Promise<void> {
  const [title, message] = await Promise.all([
    formatValue("zotlit-batch-update-server-needed-title"),
    formatValue("zotlit-batch-update-server-needed-message"),
  ]);
  Zotero.alert(Zotero.getMainWindow(), title ?? "", message ?? "");
}

export function importInObsidian(itemID: number, mode: ImportMode): void {
  const url = buildImportProtocolUrl(itemID, { sourceId: sourceId(), mode });
  logger.info("opening obsidian (import link)", { itemID, mode, url });
  launchExternalUrl(url);
}

export async function importManyInObsidian(
  itemIDs: readonly number[],
  mode: ImportMode,
): Promise<void> {
  const url = buildImportManyProtocolUrl(itemIDs, {
    sourceId: sourceId(),
    mode,
  });

  await launchOrPut(url, {
    label: "batch import",
    path: "/zotero-notes",
    body: { items: [...itemIDs], mode } satisfies ImportNotesRequest,
    count: itemIDs.length,
    messages: {
      sendingTitleId: "zotlit-batch-import-sending-title",
      sentTitleId: "zotlit-batch-import-sent-title",
      sentMessageId: "zotlit-batch-import-sent-message",
      failedTitleId: "zotlit-batch-import-failed-title",
      failedMessageId: "zotlit-batch-import-failed-message",
    },
  });
}

export function readerTopLevelItem(
  reader: _ZoteroTypes.ReaderInstance,
): Zotero.Item | null {
  if (reader.itemID === undefined) {
    logger.debug("reader has no itemID");
    return null;
  }
  return Zotero.Items.get(reader.itemID).topLevelItem;
}
