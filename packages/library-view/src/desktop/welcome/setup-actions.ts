import { FuzzySuggestModal } from "obsidian";
import type { App, TFolder } from "obsidian";

import { openSettingsTab } from "@zotlit/obsidian-kit/open-settings.ts";
import type { ViewRegistryHandle } from "@zotlit/obsidian-kit/view-atoms.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { setFolderCommand, locateZoteroCommand } from "./atoms.ts";

export function holdSetupCommands(registry: ViewRegistryHandle): () => void {
  const releases = [
    registry.mount(setFolderCommand),
    registry.mount(locateZoteroCommand),
  ];
  return () => {
    for (const release of releases) release();
  };
}

export interface SetupActions {
  openSettings: () => void;
  pickFolder: () => void;
  locateZotero: () => void;
}

export interface SetupActionsDeps {
  app: App;
  registry: ViewRegistryHandle;
  pluginId: string;
}

export function createSetupActions(deps: SetupActionsDeps): SetupActions {
  return {
    openSettings: () => {
      openSettingsTab(deps.app, deps.pluginId, ["settings_page_zotero"]);
    },
    pickFolder: () => {
      new LiteratureFolderModal(deps.app, (folder) => {
        deps.registry.set(setFolderCommand, folder.path);
      }).open();
    },
    locateZotero: () => {
      deps.registry.set(locateZoteroCommand, undefined);
    },
  };
}

class LiteratureFolderModal extends FuzzySuggestModal<TFolder> {
  readonly #onChoose: (folder: TFolder) => void;

  constructor(app: App, onChoose: (folder: TFolder) => void) {
    super(app);
    this.#onChoose = onChoose;
    this.setPlaceholder(m.welcome_pick_folder_placeholder());
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_select() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
  }

  override getItems(): TFolder[] {
    return this.app.vault.getAllFolders(false);
  }

  override getItemText(folder: TFolder): string {
    return folder.path;
  }

  override onChooseItem(folder: TFolder): void {
    this.#onChoose(folder);
  }
}
