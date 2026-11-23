import type { CitationEntryBlock } from "#obsidian/citation-popover/blocks.ts";
import type { NavigationPane } from "#obsidian/citekey-navigation/index.ts";
import { Keymap } from "obsidian";
import type { MouseEvent } from "react";

import {
  openAttachments,
  zoteroAttachmentReader,
} from "@zotlit/annotations/desktop/attachment-open/open-attachments.ts";
import type { MenuAnchor } from "@zotlit/obsidian-kit/menu.ts";
import type { WorkspaceEventHost } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { formatIndexedKey } from "@zotlit/zotero-types/keys";
import { itemSelectUri } from "@zotlit/zotero-types/uri";

export interface CitationPopoverActions {
  onOpenNote: (block: CitationEntryBlock, event: MouseEvent) => void;
  onOpenInZotero: (block: CitationEntryBlock) => void;
  onShowInLibrary: (block: CitationEntryBlock) => void;
  onOpenAttachment: (block: CitationEntryBlock, event: MouseEvent) => void;
  onDone: () => void;
  onSwitchProfile: (path: string) => void;
}

export interface CitationPopoverActionDeps {
  host: WorkspaceEventHost;
  open: (block: CitationEntryBlock, pane: NavigationPane) => void;
  hide: () => void;
  showInLibrary: (indexedKey: string) => void;
  showNotice: (message: string) => void;
  switchProfile: (path: string) => void;
  prepare?: (block: CitationEntryBlock) => Promise<CitationEntryBlock | null>;
  onAttachmentsEmpty?: (
    displayed: CitationEntryBlock,
    current: CitationEntryBlock,
  ) => void;
  log: (
    level: "debug",
    message: string,
    fields: Record<string, unknown>,
  ) => void;
}

export function createCitationPopoverActions({
  host,
  open,
  hide,
  showInLibrary,
  showNotice,
  switchProfile,
  prepare,
  onAttachmentsEmpty,
  log,
}: CitationPopoverActionDeps): CitationPopoverActions {
  let completed: boolean | Promise<boolean> = true;
  const act = (
    block: CitationEntryBlock,
    action: (current: CitationEntryBlock) => boolean | void,
  ): void => {
    if (!prepare) {
      completed = action(block) !== false;
      return;
    }
    completed = prepare(block).then(
      (current) => current !== null && action(current) !== false,
    );
  };
  return {
    onOpenNote(block, event) {
      const pane = navigationPaneOf(event);
      act(block, (current) => {
        log("debug", "Citation popover opens note", {
          citekey: block.citekey,
          pane,
        });
        open(current, pane);
      });
    },
    onOpenInZotero(block) {
      act(block, (current) => {
        log("debug", "Citation popover selects in Zotero", {
          itemKey: block.itemKey,
        });
        window.open(itemSelectUri(current.itemKey, current.groupID));
      });
    },
    onShowInLibrary(block) {
      act(block, (current) => {
        log("debug", "Citation popover shows in Library", {
          itemKey: block.itemKey,
        });
        showInLibrary(formatIndexedKey(current.itemKey, current.groupID));
      });
    },
    onOpenAttachment(block, event) {
      const button = event.currentTarget as HTMLElement;
      const anchor: MenuAnchor | undefined = prepare
        ? { rect: button.getBoundingClientRect(), doc: button.ownerDocument }
        : undefined;
      act(block, (current) => {
        if (current.attachments === "unreadable") {
          showNotice(m.notice_attachment_read_failed());
          return false;
        }
        if (current.attachments.length === 0) {
          onAttachmentsEmpty?.(block, current);
          return false;
        }
        log("debug", "Citation popover opens an attachment", {
          itemKey: block.itemKey,
          attachments: current.attachments.length,
        });
        openAttachments(current.attachments, {
          reader: zoteroAttachmentReader,
          host,
          event,
          anchor,
        });
      });
    },
    onDone: () => {
      if (typeof completed === "boolean") {
        if (completed) hide();
        return;
      }
      void completed.then((done) => {
        if (done) hide();
      });
    },
    onSwitchProfile: switchProfile,
  };
}

function navigationPaneOf(event: MouseEvent): NavigationPane {
  return event.button === 1 ? "tab" : Keymap.isModEvent(event.nativeEvent);
}
