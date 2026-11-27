import type { ProfileDialogServices } from "#desktop/profile/dialogs.ts";
import type { Context } from "effect";
import type { TFile } from "obsidian";

import type { Item } from "@zotlit/db";
import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { exitOver, valueOr } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";

import type {
  InteractiveCreationOptions,
  InteractiveCreationPorts,
} from "./creation-view.ts";
import { createNoteInteractively } from "./creation-view.ts";
import type { NoteFeature } from "./service.ts";

export type NoteCreationServices =
  | NoteFeature
  | Notifier
  | ZoteroPref
  | ProfileDialogServices;

export interface NoteCreation {
  createNoteInteractively(
    item: Item,
    options?: InteractiveCreationOptions,
  ): Promise<TFile | null>;
}

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
