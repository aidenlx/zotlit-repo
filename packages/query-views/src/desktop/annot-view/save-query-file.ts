import { Effect } from "effect";
import {
  AbstractInputSuggest,
  Modal,
  normalizePath,
  prepareSimpleSearch,
  TextComponent,
} from "obsidian";
import type { App, TFolder } from "obsidian";

import {
  dialogFooter,
  field,
  footerButton,
  frameDialog,
  note,
  NOTE_CLASS,
} from "@zotlit/obsidian-kit/dialog-frame.ts";
import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { composing } from "@zotlit/ui";

import { savedQueryFileText } from "./sidebar-query.ts";
import type { SaveQueryFileInput, SavedRecords } from "./sidebar-query.ts";

import {
  QUERY_FILE_EXTENSION,
  untitledName,
} from "#core/query-view/query-file.ts";

const FORBIDDEN = /[*"\\/<>:|?]/;

interface SaveChoice {
  readonly path: string;
  readonly records: SavedRecords;
}

class FolderSuggest extends AbstractInputSuggest<TFolder> {
  override getSuggestions(query: string): TFolder[] {
    const search = prepareSimpleSearch(query);
    return this.app.vault
      .getAllFolders(true)
      .filter((folder) => search(folder.path) !== null);
  }

  override renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.isRoot() ? "/" : folder.path);
  }
}

function filePath(folder: string, name: string): string {
  const parent = normalizePath(folder.trim());
  return normalizePath(
    `${parent === "/" ? "" : `${parent}/`}${name.trim()}.${QUERY_FILE_EXTENSION}`,
  );
}

class SaveQueryFileModal extends Modal {
  readonly #folder: string;
  readonly #askRecords: boolean;
  readonly #leftOut: readonly string[];
  readonly #name: string;
  readonly #decision = Promise.withResolvers<SaveChoice | null>();
  readonly result = this.#decision.promise;
  #saved = false;

  constructor(
    app: App,
    {
      folder,
      askRecords,
      leftOut,
      name,
    }: {
      folder: string;
      askRecords: boolean;
      leftOut: readonly string[];
      name: string;
    },
  ) {
    super(app);
    this.#folder = folder;
    this.#askRecords = askRecords;
    this.#leftOut = leftOut;
    this.#name = name;
  }

  override onOpen(): void {
    frameDialog(this);
    this.modalEl.addClass("zt-save-query-file-modal");
    this.setTitle(m.annot_view_save_title());
    const body = this.contentEl.createDiv({
      cls: "zt:flex zt:flex-col zt:gap-4",
    });
    let name = untitledName(
      this.#name.replaceAll(new RegExp(FORBIDDEN, "g"), " ").trim() ||
        m.query_file_untitled(),
      (candidate) =>
        this.app.vault.getAbstractFileByPath(
          filePath(this.#folder, candidate),
        ) !== null,
    );
    let folder = this.#folder;
    let records: SavedRecords = "this-item";

    const nameInput = new TextComponent(
      field(body, m.annot_view_save_name_label()),
    );
    nameInput.inputEl.setAttr("data-save-field", "name");
    const folderInput = new TextComponent(
      field(body, m.annot_view_save_folder_label()),
    );
    folderInput.inputEl.setAttr("data-save-field", "folder");
    new FolderSuggest(this.app, folderInput.inputEl).onSelect((chosen) => {
      folderInput.setValue(chosen.isRoot() ? "/" : chosen.path);
      folder = folderInput.getValue();
      update();
    });

    if (this.#askRecords) {
      const group = body.createEl("fieldset", {
        cls: "zt:flex zt:flex-col zt:gap-2",
      });
      group.createEl("legend", {
        text: m.annot_view_save_records_label(),
        cls: "zt:mb-2 zt:text-sm zt:leading-(--line-height-tight)",
      });
      const choices: [SavedRecords, string, string?][] = [
        ["this-item", m.annot_view_save_records_this_item()],
        [
          "note-item",
          m.annot_view_save_records_note_item(),
          m.annot_view_save_records_note_item_hint(),
        ],
      ];
      for (const [value, label, hint] of choices) {
        const row = group.createEl("label", {
          cls: "zt:flex zt:items-start zt:gap-2",
        });
        const radio = row.createEl("input", {
          type: "radio",
          value,
          attr: {
            name: "zotlit-save-query-records",
            "data-save-records": value,
          },
        });
        radio.checked = value === records;
        radio.addEventListener("change", () => {
          if (radio.checked) records = value;
        });
        const text = row.createDiv({ cls: "zt:min-w-0 zt:flex zt:flex-col" });
        text.createSpan({ text: label, cls: "zt:text-sm" });
        if (hint) text.createSpan({ text: hint, cls: NOTE_CLASS });
      }
    }

    for (const text of this.#leftOut)
      body.createEl("p", {
        cls: NOTE_CLASS,
        text,
        attr: { "data-save-left-out": "" },
      });
    const status = note(body, { status: true });
    const refusal = (): string | null => {
      if (name.trim() === "") return "";
      if (FORBIDDEN.test(name)) return m.annot_view_save_name_characters();
      const path = filePath(folder, name);
      if (this.app.vault.getAbstractFileByPath(path))
        return m.annot_view_save_name_taken({ file: path });
      return null;
    };
    const submit = () => {
      if (refusal() !== null) return;
      this.#saved = true;
      this.#decision.resolve({ path: filePath(folder, name), records });
      this.close();
    };
    const footer = dialogFooter(this);
    const save = footerButton(
      footer,
      m.annot_view_save_action(),
      submit,
    ).setCta();
    footerButton(footer, m.modal_cancel(), () => this.close());
    const update = () => {
      const refused = refusal();
      if (refused === null)
        status.set(m.annot_view_save_file({ file: filePath(folder, name) }));
      else status.set(refused, refused === "" ? "muted" : "error");
      save.setDisabled(refused !== null);
    };
    nameInput.onChange((typed) => {
      name = typed;
      update();
    });
    folderInput.onChange((typed) => {
      folder = typed;
      update();
    });
    for (const input of [nameInput, folderInput])
      input.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !composing(event)) submit();
      });
    nameInput.setValue(name);
    folderInput.setValue(folder);
    update();
    nameInput.inputEl.focus();
    nameInput.inputEl.select();
  }

  override onClose(): void {
    if (!this.#saved) this.#decision.resolve(null);
    this.contentEl.empty();
  }
}

export function saveSidebarAsQueryFile(
  app: App,
  input: Omit<SaveQueryFileInput, "records">,
): Promise<void> {
  return saveQueryFile(app, {
    askRecords: true,
    text: (records) => savedQueryFileText({ ...input, records }),
  });
}

export function saveAsQueryFile(
  app: App,
  text: string,
  {
    leftOut = [],
    name,
  }: {
    leftOut?: readonly string[];
    name?: string;
  } = {},
): Promise<void> {
  return saveQueryFile(app, {
    askRecords: false,
    leftOut,
    name,
    text: () => text,
  });
}

async function saveQueryFile(
  app: App,
  {
    askRecords,
    leftOut = [],
    name = m.query_file_untitled(),
    text,
  }: {
    askRecords: boolean;
    leftOut?: readonly string[];
    name?: string;
    text: (records: SavedRecords) => string;
  },
): Promise<void> {
  const parent = app.fileManager.getNewFileParent(
    app.workspace.getActiveFile()?.path ?? "",
  );
  const modal = new SaveQueryFileModal(app, {
    folder: parent.isRoot() ? "/" : parent.path,
    askRecords,
    leftOut,
    name,
  });
  modal.open();
  const choice = await modal.result;
  if (!choice) return;
  try {
    const folder = choice.path.includes("/")
      ? choice.path.slice(0, choice.path.lastIndexOf("/"))
      : "";
    if (folder && !app.vault.getFolderByPath(folder))
      await app.vault.createFolder(folder);
    const file = await app.vault.create(choice.path, text(choice.records));
    await app.workspace.getLeaf("tab").openFile(file, { active: true });
  } catch (error) {
    Effect.runSyncWith(logServices)(
      Effect.logError("Failed to save a Query File").pipe(
        Effect.annotateLogs({
          path: choice.path,
          error,
        }),
        withLogCategory("views", "annot-view", "save-query-file"),
      ),
    );
    new BaseNotice(m.annot_view_save_failed());
  }
}
