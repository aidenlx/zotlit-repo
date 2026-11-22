import { Effect } from "effect";
import { around } from "monkey-around";
import { Keymap, Menu } from "obsidian";
import type { Workspace } from "obsidian";

import { disposable } from "@zotlit/obsidian-kit/disposables.ts";
import {
  menuEvent,
  menuSections,
  raiseMenu,
} from "@zotlit/obsidian-kit/menu-events.ts";
import * as toast from "@zotlit/obsidian-kit/toast.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { CitekeyResolution } from "@zotlit/zotero-reads/contract/citation-lookup.ts";
import { parseIndexedKey } from "@zotlit/zotero-types/keys";
import { itemSelectUri } from "@zotlit/zotero-types/uri";

import type { NodeClickDeps } from "./click.ts";
import type { GraphLeafMembers } from "./install.ts";

declare module "@zotlit/obsidian-kit/menu-events.ts" {
  interface ZotLitMenuEvents {
    "zotlit:graph-cited-work-menu": {
      citekey: string;
      resolution: CitekeyResolution | null;
    };
  }
}

const citedWorkNodeMenu = menuEvent("zotlit:graph-cited-work-menu", [
  "open",
  "clipboard",
  "",
]);

const SECTION = menuSections(citedWorkNodeMenu);

export interface NodeRightClickDeps extends NodeClickDeps {
  resolveCitekey: (citekey: string) => CitekeyResolution | null;
  workspace: Pick<Workspace, "trigger">;
  showInLibrary: (indexedKey: string) => void;
}

export function wrapNodeRightClick(
  renderer: GraphLeafMembers["renderer"],
  deps: NodeRightClickDeps,
): Disposable {
  return disposable(
    around(renderer, {
      onNodeRightClick: (native) => (evt, id, type) => {
        const citekey = deps.citekeyOf(id);
        if (citekey === undefined) return native(evt, id, type);
        const resolution = deps.resolveCitekey(citekey);
        Effect.runSyncWith(logServices)(
          Effect.logDebug("Cited Work Node right-clicked").pipe(
            Effect.annotateLogs({
              citekey,
              resolution: resolution?.kind ?? "pending",
            }),
            withLogCategory("graph-citations"),
          ),
        );
        citedWorkMenu({
          citekey,
          resolution,
          open: deps.open,
          workspace: deps.workspace,
          showInLibrary: deps.showInLibrary,
        }).showAtMouseEvent(evt);
      },
    }),
  );
}

interface CitedWorkMenuContext
  extends
    Pick<NodeClickDeps, "open">,
    Pick<NodeRightClickDeps, "workspace" | "showInLibrary"> {
  citekey: string;
  resolution: CitekeyResolution | null;
}

function citedWorkMenu(ctx: CitedWorkMenuContext): Menu {
  const menu = new Menu();
  if (ctx.resolution?.kind !== "missing") {
    menu.addItem((item) =>
      item
        .setSection(SECTION.open)
        .setTitle(m.graph_citations_menu_create_note())
        .setIcon("file-plus")
        .onClick((evt) => ctx.open(ctx.citekey, Keymap.isModEvent(evt))),
    );
  }
  if (ctx.resolution?.kind === "unique") {
    const { key, indexedKey } = ctx.resolution.item;
    const { groupID } = parseIndexedKey(indexedKey)!;
    menu.addItem((item) =>
      item
        .setSection(SECTION.open)
        .setTitle(m.references_open_in_zotero())
        .setIcon("external-link")
        .onClick(() => {
          window.open(itemSelectUri(key, groupID));
        }),
    );
    menu.addItem((item) =>
      item
        .setSection(SECTION.open)
        .setTitle(m.library_view_show_in_library())
        .setIcon("library")
        .onClick(() => ctx.showInLibrary(indexedKey)),
    );
  }
  menu.addItem((item) =>
    item
      .setSection(SECTION.clipboard)
      .setTitle(m.graph_citations_menu_copy_citekey())
      .setIcon("copy")
      .onClick(() => void copyCitekey(ctx.citekey)),
  );
  raiseMenu(menu, {
    workspace: ctx.workspace,
    event: citedWorkNodeMenu,
    info: { citekey: ctx.citekey, resolution: ctx.resolution },
  });
  return menu;
}

function copyCitekey(citekey: string): Promise<void> {
  const done = navigator.clipboard.writeText(citekey);
  void toast.promise(done, {
    success: m.graph_citations_citekey_copied(),
    error: m.graph_citations_citekey_copy_failed(),
  });
  return done;
}
