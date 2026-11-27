import type { ObsidianOpenableAttachment } from "#core/attachment-open/resolve.ts";
import type { App, PaneType } from "obsidian";
import { Keymap, Menu, SuggestModal } from "obsidian";
import type { MouseEvent as ReactMouseEvent } from "react";

import {
  menuEvent,
  menuSections,
  raiseMenu,
} from "@zotlit/obsidian-kit/menu-events.ts";
import { showMenuAtBox, showMenuAtButton } from "@zotlit/obsidian-kit/menu.ts";
import type { MenuAnchor } from "@zotlit/obsidian-kit/menu.ts";
import type { WorkspaceEventHost } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { ZoteroOpenableAttachment } from "@zotlit/plugin-services/core/attachment-resolver/zotero-openable.ts";
import { attachmentOpenUri } from "@zotlit/zotero-types/uri";

declare module "@zotlit/obsidian-kit/menu-events.ts" {
  interface ZotLitMenuEvents {
    "zotlit:attachments-menu": {
      attachments: readonly (
        | ObsidianOpenableAttachment
        | ZoteroOpenableAttachment
      )[];
    };
  }
}

const attachmentsMenu = menuEvent("zotlit:attachments-menu", ["open", ""]);

const SECTION = menuSections(attachmentsMenu);

type OpenableRow = ObsidianOpenableAttachment | ZoteroOpenableAttachment;

export interface AttachmentReader<T extends OpenableRow> {
  icon: string;
  open: (attachment: T, pane: PaneType | boolean) => unknown;
  onEmpty?: () => void;
}

export function withFixedPane<T extends OpenableRow>(
  reader: AttachmentReader<T>,
  pane: PaneType | boolean,
): AttachmentReader<T> {
  return {
    ...reader,
    open: (attachment) => reader.open(attachment, pane),
  };
}

export type AttachmentOpenClickEvent =
  | ReactMouseEvent
  | MouseEvent
  | KeyboardEvent;

export type OpenAttachmentsOptions<T extends OpenableRow> =
  | {
      reader: AttachmentReader<T>;
      host: WorkspaceEventHost;
      event: AttachmentOpenClickEvent;
      anchor?: MenuAnchor;
    }
  | { reader: AttachmentReader<T>; app: App; event?: never };

function nativeEventOf(
  event: AttachmentOpenClickEvent,
): MouseEvent | KeyboardEvent {
  return "nativeEvent" in event ? event.nativeEvent : event;
}

export function openAttachments<T extends OpenableRow>(
  attachments: readonly T[],
  options: OpenAttachmentsOptions<T>,
): void {
  const { reader } = options;
  const [first, ...rest] = attachments;
  if (!first) {
    reader.onEmpty?.();
    return;
  }
  if (rest.length === 0) {
    void reader.open(
      first,
      "host" in options
        ? Keymap.isModEvent(nativeEventOf(options.event))
        : false,
    );
    return;
  }
  if ("host" in options) {
    showAttachmentMenu(attachments, reader, {
      host: options.host,
      event: options.event,
      anchor: options.anchor,
    });
    return;
  }
  new AttachmentPickerModal(options.app, attachments, reader).open();
}

export const zoteroAttachmentReader: AttachmentReader<ZoteroOpenableAttachment> =
  {
    icon: "paperclip",
    open({ key, groupID }) {
      window.open(attachmentOpenUri(key, groupID));
    },
  };

function showAttachmentMenu<T extends OpenableRow>(
  attachments: readonly T[],
  reader: AttachmentReader<T>,
  click: {
    host: WorkspaceEventHost;
    event: AttachmentOpenClickEvent;
    anchor?: MenuAnchor;
  },
): void {
  const menu = new Menu();
  for (const attachment of attachments) {
    menu.addItem((item) =>
      item
        .setSection(SECTION.open)
        .setTitle(attachment.label)
        .setIcon(reader.icon)
        .onClick((evt) => void reader.open(attachment, Keymap.isModEvent(evt))),
    );
  }
  raiseMenu(menu, {
    workspace: click.host.workspace,
    event: attachmentsMenu,
    info: {
      attachments,
    },
  });

  const { event, anchor } = click;
  if (anchor) {
    showMenuAtBox(menu, anchor);
    return;
  }
  showMenuAtButton(menu, event.currentTarget as HTMLElement);
}

class AttachmentPickerModal<T extends OpenableRow> extends SuggestModal<T> {
  readonly #attachments: readonly T[];
  readonly #reader: AttachmentReader<T>;

  constructor(
    app: App,
    attachments: readonly T[],
    reader: AttachmentReader<T>,
  ) {
    super(app);
    this.#attachments = attachments;
    this.#reader = reader;
    this.setPlaceholder(m.modal_select_pdf_placeholder());
  }

  override getSuggestions(query: string): T[] {
    const needle = query.toLowerCase();
    return this.#attachments.filter((attachment) =>
      attachment.label.toLowerCase().includes(needle),
    );
  }

  override renderSuggestion(attachment: T, el: HTMLElement): void {
    el.setText(attachment.label);
  }

  override onChooseSuggestion(
    attachment: T,
    evt: MouseEvent | KeyboardEvent,
  ): void {
    void this.#reader.open(attachment, Keymap.isModEvent(evt));
  }
}
