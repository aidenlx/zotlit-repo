// Sending a reader to one Item's Attachments, shared by every surface that offers the action.

import type { ObsidianOpenableAttachment } from "#core/attachment-open/resolve.ts";
import { Keymap, Menu, SuggestModal } from "obsidian";
import type { App, PaneType } from "obsidian";
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
    /** The picker over an Item's Attachments, when there is more than one. */
    "zotlit:attachments-menu": {
      attachments: readonly (
        | ObsidianOpenableAttachment
        | ZoteroOpenableAttachment
      )[];
    };
  }
}

/** The picker over an Item's Attachments. */
const attachmentsMenu = menuEvent("zotlit:attachments-menu", ["open", ""]);

const SECTION = menuSections(attachmentsMenu);

/** One row a picker offers, whichever reader it opens through. */
type OpenableRow = ObsidianOpenableAttachment | ZoteroOpenableAttachment;

/** Where an Attachment opens, and how — the selection policy stays written once and shared by both. */
export interface AttachmentReader<T extends OpenableRow> {
  /** Icon a picker row gets. */
  icon: string;
  /** Open one Attachment, honoring a Mod-click/Mod-Enter's new-pane request. */
  open: (attachment: T, pane: PaneType | boolean) => unknown;
  /**
   * Nothing qualified. Omit to leave the click inert — a reader whose caller
   * already hides its own control over an empty list (the Zotero readers)
   * needs no notice of its own.
   */
  onEmpty?: () => void;
}

/** A reader that always opens onto `pane`, ignoring what its own click would have chosen. */
export function withFixedPane<T extends OpenableRow>(
  reader: AttachmentReader<T>,
  pane: PaneType | boolean,
): AttachmentReader<T> {
  return {
    ...reader,
    open: (attachment) => reader.open(attachment, pane),
  };
}

/**
 * A click a caller can hand `openAttachments`: React's `SyntheticEvent` wrapper
 * from the two React surfaces (Citation Popover, References Sidebar), or the
 * DOM event Obsidian's own `MenuItem.onClick` hands the Literature Note file
 * menu — Obsidian dispatches either a `MouseEvent` or, for a keyboard-driven
 * selection, a `KeyboardEvent`.
 */
export type AttachmentOpenClickEvent =
  | ReactMouseEvent
  | MouseEvent
  | KeyboardEvent;

/**
 * A pointer event shows a context menu at the click; no event (the protocol
 * handler, the command palette, the quick switcher) shows a Suggest modal
 * picker instead. The picker differs by invocation, not by reader. The modal
 * is hosted on the `App`; the menu needs only the `host` workspace it raises
 * `zotlit:attachments-menu` on.
 */
export type OpenAttachmentsOptions<T extends OpenableRow> =
  | {
      reader: AttachmentReader<T>;
      host: WorkspaceEventHost;
      event: AttachmentOpenClickEvent;
      /**
       * The box and window the picker anchors to when the trigger cannot be
       * measured at show time. An async handler reaches its first `await`
       * before the picker opens, and `currentTarget` is null by then, so such a
       * caller reads the box while dispatch is still live and passes it here.
       */
      anchor?: MenuAnchor;
    }
  | { reader: AttachmentReader<T>; app: App; event?: never };

/** The DOM event a click carries, unwrapped from React's `SyntheticEvent`. */
function nativeEventOf(
  event: AttachmentOpenClickEvent,
): MouseEvent | KeyboardEvent {
  return "nativeEvent" in event ? event.nativeEvent : event;
}

/**
 * Send a reader to the Item's Attachments: one opens straight away, several
 * offer a picker, and an empty list defers to {@link AttachmentReader.onEmpty}
 * — the selection policy stays written once here, for every entry point.
 */
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

/** Zotero's own reader, reached through the deep link it registers on the OS. */
export const zoteroAttachmentReader: AttachmentReader<ZoteroOpenableAttachment> =
  {
    icon: "paperclip",
    open({ key, groupID }) {
      window.open(attachmentOpenUri(key, groupID));
    },
  };

/**
 * Offer one row per Attachment, anchored under the control that asked for it —
 * so it lands in the same place whether the control was clicked or activated
 * from the keyboard.
 */
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

/** The picker for an event-less invocation: the protocol handler, the command palette, the quick switcher. */
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
