import { Modal, TextComponent } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";

import {
  normalizePartialName,
  partialFilename,
  partialNameRefusal,
} from "@zotlit/notes/core/template/defaults.ts";
import type { PartialNameRefusal } from "@zotlit/notes/core/template/defaults.ts";
import type { TemplateOperations } from "@zotlit/notes/obsidian/template/service.ts";
import {
  dialogFooter,
  field,
  footerButton,
  frameDialog,
  note,
} from "@zotlit/obsidian-kit/dialog-frame.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { TemplateLanguage } from "@zotlit/templates/facade";

export type SharedPartialActions = Pick<
  TemplateOperations,
  "getPartialNames" | "createPartial"
>;

export interface CreateSharedPartialOptions {
  name?: string;
  source?: string;
  language?: TemplateLanguage;
  open?: "split" | "tab" | false;
  from?: WorkspaceLeaf;
}

export function openNewPartialPrompt(
  app: App,
  prompt: {
    readonly taken: readonly string[];
    readonly seed?: string | undefined;
  },
  settle: (name: string | null) => void,
): Modal {
  const modal = new NewPartialModal(app, prompt.taken, prompt.seed ?? "");
  void modal.result.then(settle);
  modal.open();
  return modal;
}

function refusalText(refusal: PartialNameRefusal, name: string): string {
  switch (refusal) {
    case "empty":
      return "";
    case "characters":
      return m.partial_name_characters();
    case "reserved":
      return m.partial_name_reserved({ name });
    case "duplicate":
      return m.partial_name_duplicate({ name });
  }
}

export class NewPartialModal extends Modal {
  readonly #taken: readonly string[];
  readonly #seed: string;
  readonly #decision = Promise.withResolvers<string | null>();
  readonly result = this.#decision.promise;
  #created = false;

  constructor(app: App, taken: readonly string[], seed: string) {
    super(app);
    this.#taken = taken;
    this.#seed = seed;
  }

  override onOpen(): void {
    frameDialog(this);
    this.setTitle(m.partial_new_title());
    let name = normalizePartialName(this.#seed);
    const input = new TextComponent(
      field(this.contentEl, m.partial_new_name_label()),
    ).setPlaceholder(m.partial_new_name_placeholder());
    const status = note(this.contentEl, { status: true });
    const submit = () => {
      if (partialNameRefusal(name, this.#taken)) return;
      this.#created = true;
      this.#decision.resolve(name);
      this.close();
    };
    const footer = dialogFooter(this);
    const create = footerButton(
      footer,
      m.partial_new_action(),
      submit,
    ).setCta();
    footerButton(footer, m.modal_cancel(), () => this.close());
    const update = (typed: string) => {
      name = normalizePartialName(typed);
      const refusal = partialNameRefusal(name, this.#taken);
      if (refusal)
        status.set(
          refusalText(refusal, name),
          refusal === "empty" ? "muted" : "error",
        );
      else status.set(m.partial_new_file({ file: partialFilename(name) }));
      create.setDisabled(refusal !== null);
    };
    input.onChange(update);
    input.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
    });
    input.setValue(this.#seed);
    update(this.#seed);
    input.inputEl.focus();
    input.inputEl.select();
  }

  override onClose(): void {
    if (!this.#created) this.#decision.resolve(null);
    this.contentEl.empty();
  }
}
