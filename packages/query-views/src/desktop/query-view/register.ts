import type { App, Menu, Plugin, TFile, TFolder } from "obsidian";
import { Keymap, normalizePath } from "obsidian";

import { MENU_SECTION } from "@zotlit/plugin-kernel/menu-section.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type {
  FileMenuSegment,
  FolderMenuSegment,
} from "@zotlit/plugin-services/obsidian/file-menu.ts";

import { createQueryFileEmbed } from "./embed.ts";
import { QueryFileView, QUERY_FILE_VIEW_TYPE } from "./file-view.ts";
import type { QueryViewDeps } from "./view.tsx";

import {
  newQueryFileText,
  QUERY_FILE_EXTENSION,
  untitledName,
} from "#core/query-view/query-file.ts";
import { installEmptyViewAction } from "#obsidian/query-view/empty-view-action.ts";
import { registerEmbed } from "#obsidian/query-view/obsidian-private/embed-registry.ts";

type QueryFilePlugin = Pick<
  Plugin,
  "registerView" | "registerExtensions" | "addCommand" | "register" | "app"
>;

export function registerQueryFileView(
  plugin: QueryFilePlugin,
  deps: QueryViewDeps,
): void {
  plugin.registerView(
    QUERY_FILE_VIEW_TYPE,
    (leaf) => new QueryFileView(leaf, deps),
  );
  plugin.registerExtensions([QUERY_FILE_EXTENSION], QUERY_FILE_VIEW_TYPE);
  const unregisterEmbed = registerEmbed(
    plugin.app,
    QUERY_FILE_EXTENSION,
    createQueryFileEmbed(deps),
  );
  if (unregisterEmbed) plugin.register(unregisterEmbed);
  const { app } = plugin;
  const newQueryFile = (event?: MouseEvent | KeyboardEvent) =>
    void createQueryFile(
      app,
      app.fileManager.getNewFileParent(
        app.workspace.getActiveFile()?.path ?? "",
      ),
      event,
    );
  const command = plugin.addCommand({
    id: "new-query-file",
    name: m.command_new_query_file_name(),
    callback: () => newQueryFile(),
  });
  const emptyTab = new DisposableStack();
  plugin.register(() => emptyTab.dispose());
  app.workspace.onLayoutReady(() => {
    if (emptyTab.disposed) return;
    emptyTab.use(
      installEmptyViewAction(app, { commandId: command.id, run: newQueryFile }),
    );
  });
}

function freePath(app: App, folder: TFolder): string {
  const path = (name: string) =>
    normalizePath(
      `${folder.isRoot() ? "" : `${folder.path}/`}${name}.${QUERY_FILE_EXTENSION}`,
    );
  return path(
    untitledName(
      m.query_file_untitled(),
      (name) => app.vault.getAbstractFileByPath(path(name)) !== null,
    ),
  );
}

export async function createQueryFile(
  app: App,
  folder: TFolder,
  event?: MouseEvent | KeyboardEvent,
): Promise<TFile> {
  const file = await app.vault.create(
    freePath(app, folder),
    newQueryFileText({
      items: m.query_file_items_view_name(),
      annotations: m.query_file_annotations_view_name(),
    }),
  );
  const leaf = app.workspace.getLeaf(event ? Keymap.isModEvent(event) : false);
  await leaf.openFile(file, { active: true, eState: { rename: "all" } });
  return file;
}

function addNewQueryFile(menu: Menu, app: App, folder: TFolder): void {
  menu.addItem((item) =>
    item
      .setSection(MENU_SECTION.create)
      .setTitle(m.query_file_new())
      .setIcon("list-filter")
      .onClick((event) => void createQueryFile(app, folder, event)),
  );
}

export function queryFileFolderMenu(app: App): FolderMenuSegment {
  return (menu, { folder, source }) => {
    if (source !== "file-explorer-context-menu") return;
    addNewQueryFile(menu, app, folder);
  };
}

export function queryFileFileMenu(app: App): FileMenuSegment {
  return (menu, { file, source }) => {
    if (source !== "file-explorer-context-menu" || !file.parent) return;
    addNewQueryFile(menu, app, file.parent);
  };
}
