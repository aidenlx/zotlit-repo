import { Effect, Layer } from "effect";
import { TFile } from "obsidian";

import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { ShowInLibrary } from "@zotlit/obsidian-kit/show-in-library.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { MENU_SECTION } from "@zotlit/plugin-kernel/menu-section.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { FileMenuSegment } from "@zotlit/plugin-services/obsidian/file-menu.ts";
import { itemKeyFromFrontmatter } from "@zotlit/plugin-services/obsidian/note-index/parse.ts";

export const layerShowInLibraryActions: Layer.Layer<
  never,
  never,
  PluginHost | Workspace | MetadataCache | ShowInLibrary
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const workspace = yield* Workspace;
    const metadata = yield* MetadataCache;
    const showInLibrary = yield* ShowInLibrary;
    const bridge = yield* scopedBridge;
    const activeItemKey = Effect.gen(function* () {
      const file = yield* workspace.getActiveFile;
      if (!(file instanceof TFile) || file.extension !== "md") return null;
      return itemKeyFromFrontmatter(yield* metadata.fileCache(file));
    });
    yield* host.addCommand({
      id: "show-in-library",
      name: m.command_show_in_library_name(),
      checkCallback: (checking) => {
        const indexedKey = bridge.runSync(activeItemKey);
        if (indexedKey === null) return false;
        if (!checking) bridge.runAndForget(showInLibrary.show(indexedKey));
        return true;
      },
    });
  }),
);

export function showInLibraryFileMenu(
  show: (indexedKey: string) => void,
): FileMenuSegment {
  return (menu, { itemKey }) => {
    if (itemKey === null) return;
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.view)
        .setTitle(m.library_view_show_in_library())
        .setIcon("library")
        .onClick(() => show(itemKey)),
    );
  };
}
