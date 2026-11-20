import type { MenuItem, ReaderHost } from "#/core/index.ts";
import type { ReaderLayer } from "#/obsidian/layer.ts";
import type { ElectronWindow } from "#/obsidian/private.ts";
import type { TFile } from "obsidian";
import { loadPdfJs, Menu, Platform, setIcon } from "obsidian";

import { legacyText } from "#/obsidian/legacy-text.ts";

const SECTIONS: Readonly<Record<NonNullable<MenuItem["section"]>, string>> = {
  copy: "clipboard",
  link: "clipboard",
  action: "action",
  view: "view",
  system: "system",
};

function isMouseEvent(at: MouseEvent | HTMLElement): at is MouseEvent {
  return "clientX" in at;
}

export function showBelow(menu: Menu, element: HTMLElement): void {
  if (element.hasClass("has-active-menu")) return;
  menu.setParentElement(element);
  const box = element.getBoundingClientRect();
  menu.showAtPosition(
    { x: box.left, y: box.bottom, width: box.width, overlap: true, left: true },
    element.doc,
  );
}

function showMenu(at: MouseEvent | HTMLElement, items: readonly MenuItem[]) {
  const menu = new Menu();
  for (const entry of items) {
    menu.addItem((item) => {
      item
        .setTitle(entry.title)
        .setSection(SECTIONS[entry.section ?? "action"])
        .onClick(() => entry.run());
      if (entry.icon !== undefined) item.setIcon(entry.icon);
      if (entry.checked !== undefined) item.setChecked(entry.checked);
      if (entry.disabled !== undefined) item.setDisabled(entry.disabled);
    });
  }
  if (isMouseEvent(at)) {
    menu.showAtMouseEvent(at);
    return;
  }
  showBelow(menu, at);
}

export function obsidianHost(
  layer: ReaderLayer,
  target: {
    readonly file: TFile;
    readonly sourcePath: string | null;
    readonly element: HTMLElement;
  },
): ReaderHost {
  const { app } = layer;
  const prefix = `${layer.viewType}:`;
  const host: ReaderHost = {
    t: layer.t,
    icon: (element, name) => setIcon(element, name),
    menu: showMenu,
    copy: (text) => target.element.win.navigator.clipboard.writeText(text),
    link: (subpath, alias) =>
      app.fileManager.generateMarkdownLink(
        target.file,
        target.sourcePath ?? "",
        subpath,
        alias,
      ),
    openExternal: (url) => {
      target.element.win.open(url);
    },
    storage: {
      get: (key) => app.loadLocalStorage(prefix + key) as unknown,
      set: (key, value) => app.saveLocalStorage(prefix + key, value),
    },
    report: layer.report,
    watchTheme: (onChange) => {
      const ref = app.workspace.on("css-change", onChange);
      return () => app.workspace.offref(ref);
    },
    legacyText: (request) => legacyText(loadPdfJs, request),
  };
  if (Platform.isMacOS && Platform.isDesktopApp) {
    host.lookUp = () => {
      (target.element.win as ElectronWindow).electron?.remote
        .getCurrentWebContents()
        .showDefinitionForSelection();
    };
  }
  return host;
}
