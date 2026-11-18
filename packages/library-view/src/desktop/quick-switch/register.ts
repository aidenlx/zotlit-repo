import type { App, Plugin } from "obsidian";

import type { TargetOpener } from "@zotlit/annotations/desktop/attachment-open/open-target.ts";
import type { LiteratureNoteAttachmentsHandle } from "@zotlit/annotations/obsidian/attachment-open/handle.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { ItemLookupHandle } from "@zotlit/plugin-services/obsidian/item-lookup/handle.ts";
import type { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { QuickSwitchModal } from "./modal.ts";
import type { NoteResultDeps } from "./result-actions.ts";

export interface QuickSwitchDeps extends NoteResultDeps {
  app: App;
  /** Resolves the Attachments of the PDF a result asks for. */
  attachments: LiteratureNoteAttachmentsHandle;
  lookup: ItemLookupHandle;
  settings: Pick<PluginSettings["Service"], "current">;
  /** Also runs each PDF open a result fires; unload interrupts it. */
  bridge: Pick<EffectBridge, "runSync" | "runAndForget">;
  /** Opens the PDF a result asks for. */
  opener: Pick<TargetOpener["Service"], "open">;
  /** Open the Library View with the Item selected. */
  showInLibrary: (indexedKey: string) => Promise<void>;
}

export function registerQuickSwitch(
  plugin: Pick<Plugin, "addCommand">,
  deps: QuickSwitchDeps,
): void {
  plugin.addCommand({
    id: "note-quick-switcher",
    name: m.command_open_lit_note_name(),
    callback: () => {
      openQuickSwitch(deps);
    },
  });
}

export function openQuickSwitch(deps: QuickSwitchDeps): QuickSwitchModal {
  const modal = new QuickSwitchModal(deps);
  modal.open();
  return modal;
}
