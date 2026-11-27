import { Effect, Layer } from "effect";
import type { App, Plugin } from "obsidian";
import { addIcon } from "obsidian";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { ShowInLibrary } from "@zotlit/obsidian-kit/show-in-library.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { LIBRARY_VIEW_ROW_LIMIT } from "./document.ts";
import { libraryItemCommand } from "./item-actions.ts";
import type { LibraryViewDeps } from "./view.ts";
import { LIBRARY_VIEW_TYPE, LibraryView } from "./view.ts";

import { ZOTLIT_MARK_ICON, zotlitMarkSvg } from "#core/library/icon.ts";

type LibraryViewPlugin = Pick<
  Plugin,
  "registerView" | "register" | "addCommand" | "addRibbonIcon" | "app"
>;

export function registerLibraryView(
  plugin: LibraryViewPlugin,
  deps: LibraryViewDeps,
): void {
  plugin.register(deps.registry.mount(libraryItemCommand));
  addIcon(ZOTLIT_MARK_ICON, zotlitMarkSvg());
  plugin.registerView(LIBRARY_VIEW_TYPE, (leaf) => new LibraryView(leaf, deps));
  const open = () => void openLibraryView(plugin.app);
  plugin.addCommand({
    id: "open-library-view",
    name: m.command_open_library_view_name(),
    callback: open,
  });
  plugin.addRibbonIcon(
    ZOTLIT_MARK_ICON,
    m.command_open_library_view_name(),
    open,
  );
}

export async function openLibraryView(
  app: App,
  { pane = "tab" }: { pane?: "tab" | "first-screen" } = {},
): Promise<LibraryView | null> {
  const { workspace } = app;
  let leaf = workspace.getLeavesOfType(LIBRARY_VIEW_TYPE)[0];
  if (!leaf) {
    const active =
      pane === "first-screen" ? workspace.getMostRecentLeaf() : null;
    leaf =
      active?.view.getViewType() === "empty"
        ? active
        : workspace.getLeaf("tab");
    await leaf.setViewState({ type: LIBRARY_VIEW_TYPE, active: true });
  } else {
    workspace.setActiveLeaf(leaf, { focus: true });
  }
  await workspace.revealLeaf(leaf);
  if (leaf.view instanceof LibraryView) leaf.view.arrive();
  return leaf.view instanceof LibraryView ? leaf.view : null;
}

export async function showInLibrary(
  app: App,
  indexedKey: string,
): Promise<void> {
  const view = await openLibraryView(app);
  const outcome = await view?.reveal(indexedKey);
  if (outcome === "not-listed")
    new BaseNotice(
      m.library_view_reveal_not_listed({ limit: LIBRARY_VIEW_ROW_LIMIT }),
    );
  else if (outcome === "not-found")
    new BaseNotice(m.library_view_reveal_not_found());
}

export const layerShowInLibrary: Layer.Layer<
  ShowInLibrary,
  never,
  ObsidianApp
> = Layer.effect(
  ShowInLibrary,
  Effect.gen(function* () {
    const app = yield* ObsidianApp;
    return ShowInLibrary.of({
      show: Effect.fn("ShowInLibrary.show")((indexedKey: string) =>
        Effect.tryPromise(() => showInLibrary(app, indexedKey)).pipe(
          Effect.catch((error) =>
            Effect.logWarning(
              "Could not show the Item in the Library View",
            ).pipe(Effect.annotateLogs({ indexedKey, error })),
          ),
          withLogCategory("library-view"),
        ),
      ),
    });
  }),
);
