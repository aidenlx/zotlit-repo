import type { Plugin } from "obsidian";
import { TFile } from "obsidian";

import * as toast from "@zotlit/obsidian-kit/toast.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { formatIndexedKey } from "@zotlit/zotero-types/keys";
import type { ParsedIndexedKey } from "@zotlit/zotero-types/keys";

import { itemKeyFromFrontmatter } from "#obsidian/note-index/service.ts";

export type IndexedKeyKind = "item" | "annotation";

export interface IndexedKeyCopyTarget {
  indexedKey: string;
  kind: IndexedKeyKind;
}

export function indexedKeyForClipboard(identity: ParsedIndexedKey): string {
  return formatIndexedKey(identity.key, identity.groupID);
}

export function copyIndexedKey(indexedKey: string): Promise<void> {
  const done = navigator.clipboard.writeText(indexedKey);
  void toast.promise(done, {
    success: m.indexed_key_copied(),
    error: m.indexed_key_copy_failed(),
  });
  return done;
}

export function addIndexedKeyActions(
  plugin: Pick<Plugin, "addCommand" | "app">,
): void {
  plugin.addCommand({
    id: "copy-item-key",
    name: m.command_copy_item_key_name(),
    checkCallback(checking) {
      const file = plugin.app.workspace.getActiveFile();
      if (!(file instanceof TFile)) return false;
      const indexedKey = itemKeyFromFrontmatter(
        plugin.app.metadataCache.getFileCache(file),
      );
      if (!indexedKey) return false;
      if (!checking) void copyIndexedKey(indexedKey);
      return true;
    },
  });
}
