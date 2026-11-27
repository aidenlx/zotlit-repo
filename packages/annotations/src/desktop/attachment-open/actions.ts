import type { OpenablePdfs } from "#core/attachment-open/openable.ts";
import type { ObsidianOpenableAttachment } from "#core/attachment-open/resolve.ts";
import type { LiteratureNoteAttachmentsHandle } from "#obsidian/attachment-open/handle.ts";
import { TFile } from "obsidian";
import type { App, PaneType, Plugin } from "obsidian";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { itemKeyFromFrontmatter } from "@zotlit/plugin-services/obsidian/note-index/service.ts";

import { openAttachments } from "./open-attachments.ts";
import type { AttachmentReader } from "./open-attachments.ts";
import type { OpenTarget, TargetOpener } from "./open-target.ts";

export interface TargetOpenGesture {
  open(target: OpenTarget, pane: PaneType | boolean): void;
}

export function openGesture(
  opener: Pick<TargetOpener["Service"], "open">,
  run: (open: ReturnType<TargetOpener["Service"]["open"]>) => void,
): TargetOpenGesture {
  return { open: (target, pane) => run(opener.open(target, pane)) };
}

export function pdfPickerReader(
  opener: TargetOpenGesture,
  pdfs: Pick<OpenablePdfs, "filesUnavailable">,
): AttachmentReader<ObsidianOpenableAttachment> {
  return {
    icon: "file-text",
    onEmpty: () =>
      new BaseNotice(
        pdfs.filesUnavailable
          ? m.notice_needs_local_zotero()
          : m.notice_no_pdf_attachment(),
      ),
    open: (attachment, pane) =>
      opener.open(
        { kind: "attachment", attachmentKey: attachment.indexedKey },
        pane,
      ),
  };
}

export interface AttachmentOpenDeps {
  app: App;
  attachments: LiteratureNoteAttachmentsHandle;
  opener: Pick<TargetOpener["Service"], "open">;
  bridge: Pick<EffectBridge, "runAndForget">;
}

async function runOpenPdfCommand(
  deps: AttachmentOpenDeps,
  indexedKey: string,
): Promise<void> {
  const pdfs = await deps.attachments.literatureNoteAttachments(indexedKey);
  if (!pdfs) return;
  openAttachments(pdfs.attachments, {
    reader: pdfPickerReader(
      openGesture(deps.opener, deps.bridge.runAndForget),
      pdfs,
    ),
    app: deps.app,
  });
}

export function addAttachmentOpenActions(
  plugin: Pick<Plugin, "addCommand">,
  deps: AttachmentOpenDeps,
): void {
  plugin.addCommand({
    id: "open-pdf",
    name: m.command_open_pdf_name(),
    checkCallback(checking) {
      const file = deps.app.workspace.getActiveFile();
      if (!(file instanceof TFile)) return false;
      const indexedKey = itemKeyFromFrontmatter(
        deps.app.metadataCache.getFileCache(file),
      );
      if (!indexedKey) return false;
      if (!checking) void runOpenPdfCommand(deps, indexedKey);
      return true;
    },
  });
}
