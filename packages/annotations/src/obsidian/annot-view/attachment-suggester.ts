import { FuzzySuggestModal } from "obsidian";
import type { App } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";

import type { AttachmentLine } from "./presentation.ts";

export type AttachmentOptions = Extract<
  AttachmentLine,
  { kind: "picker" }
>["options"];

const SUGGESTER_CLASS = "zt-annot-attachment-suggester";

class AttachmentSuggester extends FuzzySuggestModal<AttachmentOptions[number]> {
  readonly #options: AttachmentOptions;
  readonly #choose: (indexedKey: string) => void;

  constructor(
    app: App,
    options: AttachmentOptions,
    choose: (indexedKey: string) => void,
  ) {
    super(app);
    this.#options = options;
    this.#choose = choose;
    this.setPlaceholder(m.annot_view_attachment_choose());
    this.modalEl.addClass(SUGGESTER_CLASS);
  }

  override getItems(): AttachmentOptions {
    return this.#options;
  }

  override getItemText(option: AttachmentOptions[number]): string {
    return option.label;
  }

  override onChooseItem(option: AttachmentOptions[number]): void {
    this.#choose(option.key);
  }
}

export function chooseAttachment(
  app: App,
  options: AttachmentOptions,
  choose: (indexedKey: string) => void,
): void {
  new AttachmentSuggester(app, options, choose).open();
}
