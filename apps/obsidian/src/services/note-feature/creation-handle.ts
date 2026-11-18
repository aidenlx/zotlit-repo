// The interactive note creation for callers outside Effect: the Note Feature's views.
import type { Context } from "effect";
import type { TFile } from "obsidian";

import type { Item } from "@zotlit/db";
import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { exitOver, valueOr } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";

import type { ZoteroPref } from "@/services/zotero-pref/service.ts";
import type { ProfileDialogServices } from "@/setting-tab/profile-dialogs.ts";

import { createNoteInteractively } from "./creation-view.ts";
import type {
  InteractiveCreationOptions,
  InteractiveCreationPorts,
} from "./creation-view.ts";
import type { NoteFeature } from "./service.ts";

/** The services the interactive creation and the Profile dialogs it opens read. */
export type NoteCreationServices =
  | NoteFeature
  | Notifier
  | ZoteroPref
  | ProfileDialogServices;

export interface NoteCreation {
  /** @see createNoteInteractively */
  createNoteInteractively(
    item: Item,
    options?: InteractiveCreationOptions,
  ): Promise<TFile | null>;
}

/**
 * The interactive creation over `context` and `ports`, run through `bridge`.
 * It resolves with the created file, or `null`, and rejects with what the
 * plan failed with. Unload interrupts it: the picker closes, and it resolves
 * `null`, as a cancelled creation does.
 */
export function bindNoteCreation(
  bridge: Pick<EffectBridge, "runPromiseExit">,
  context: Context.Context<NoteCreationServices>,
  ports: InteractiveCreationPorts,
): NoteCreation {
  const runExit = exitOver(bridge, context);
  return {
    createNoteInteractively: async (item, options) =>
      valueOr(
        await runExit(createNoteInteractively(ports, item, options)),
        null,
      ),
  };
}
