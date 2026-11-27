import type { Editor, TFile } from "obsidian";
import { Keymap } from "obsidian";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { ItemSearchModal } from "@zotlit/plugin-services/obsidian/item-lookup/search-modal.ts";
import type { SearchHit } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";

import { readDocumentCitedKeys } from "./document-citations.ts";
import {
  commitCitationInsert,
  resolveCitationInsert,
  writeCitation,
} from "./editor-suggest.ts";
import type { CitationSuggestDeps } from "./register.ts";

export class InsertCitationModal extends ItemSearchModal {
  readonly #deps: CitationSuggestDeps;
  readonly #editor: Editor;
  readonly #file: TFile | null;
  #documentController?: AbortController;
  #cited: Promise<readonly string[]> = Promise.resolve([]);

  constructor(deps: CitationSuggestDeps, editor: Editor, file: TFile | null) {
    super(deps);
    this.#deps = deps;
    this.#editor = editor;
    this.#file = file;
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_insert_citation() },
      { command: "⇧↵", purpose: m.instruction_insert_alternate_citation() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
    this.scope.register(["Shift"], "Enter", (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });
  }

  override onOpen(): void {
    this.#documentController = new AbortController();
    this.#cited = readDocumentCitedKeys(
      this.#deps,
      this.#file,
      this.#documentController.signal,
    );
    super.onOpen();
  }

  override onClose(): void {
    this.#documentController?.abort();
    super.onClose();
  }

  override async getSuggestions(query: string): Promise<SearchHit[]> {
    const controller = this.#documentController;
    const cited = await this.#cited;
    if (!controller || controller.signal.aborted) return [];
    return super.getSuggestions(query, { cited });
  }

  override async onChooseSuggestion(
    hit: SearchHit,
    evt: MouseEvent | KeyboardEvent,
    // oxlint-disable-next-line typescript/no-misused-promises -- tests await the returned promise, so the method stays async
  ): Promise<void> {
    const before = this.#editor.getValue();
    const from = this.#editor.getCursor("from");
    const to = this.#editor.getCursor("to");
    const outcome = await resolveCitationInsert(
      this.#deps,
      hit,
      Keymap.isModifier(evt, "Shift") ? "alt" : "main",
    );
    if (!outcome || this.#editor.getValue() !== before) return;
    if (outcome.kind === "notice") {
      new BaseNotice(outcome.message);
      return;
    }
    commitCitationInsert(this.#deps, {
      indexedKey: hit.item.indexedKey,
      text: outcome.text,
      insert: () => writeCitation(this.#editor, outcome.text, { from, to }),
    });
  }
}
