import { Keymap, Platform } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";
import { ItemSearchModal } from "@zotlit/plugin-services/obsidian/item-lookup/search-modal.ts";
import type { SearchHit } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";

import type { QuickSwitchDeps } from "./register.ts";
import { openItemPdf, openOrCreateNote } from "./result-actions.ts";

function modGlyph(): string {
  return Platform.isMacOS ? "⌘" : "Ctrl";
}

function shiftGlyph(): string {
  return Platform.isMacOS ? "⇧" : "Shift";
}

function altGlyph(): string {
  return Platform.isMacOS ? "⌥" : "Alt";
}

export class QuickSwitchModal extends ItemSearchModal {
  readonly #deps: QuickSwitchDeps;

  constructor(deps: QuickSwitchDeps) {
    super(deps);
    this.#deps = deps;
    this.setPlaceholder(m.modal_literature_search_placeholder());
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_open_lit_note() },
      { command: `${modGlyph()}↵`, purpose: m.instruction_new_pane() },
      { command: `${shiftGlyph()}↵`, purpose: m.instruction_open_pdf() },
      {
        command: `${altGlyph()}↵`,
        purpose: m.instruction_show_in_library(),
      },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
    this.scope.register(["Mod"], "Enter", (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });
    this.scope.register(["Shift"], "Enter", (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });
    this.scope.register(["Mod", "Shift"], "Enter", (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });
    this.scope.register(["Alt"], "Enter", (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });
  }

  override async onChooseSuggestion(
    hit: SearchHit,
    evt: MouseEvent | KeyboardEvent,
    // oxlint-disable-next-line typescript/no-misused-promises -- tests await the returned promise, so the method stays async
  ): Promise<void> {
    const { indexedKey } = hit.item;
    if (evt.altKey) {
      await this.#deps.showInLibrary(indexedKey);
      return;
    }
    if (evt.shiftKey) {
      await openItemPdf(this.#deps, indexedKey, Keymap.isModEvent(evt));
      return;
    }
    await openOrCreateNote(this.#deps, {
      indexedKey,
      item: hit.item,
      newPane: Keymap.isModEvent(evt),
    });
  }
}
