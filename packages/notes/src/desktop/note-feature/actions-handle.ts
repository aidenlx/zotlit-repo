import type { NoteImportView } from "#desktop/note-import/view.ts";
import type { ActiveNote } from "#obsidian/note-feature/update-notes-view.ts";
import type { Context, Effect } from "effect";
import type { TFile } from "obsidian";

import { exitOver, valueOr } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";

import type { NoteActionPorts, NoteActionServices } from "./actions-view.ts";
import {
  overwriteNote,
  reimportNote,
  switchProfile,
  updateAll,
  updateNote,
  updateNotes,
} from "./actions-view.ts";
import type { InteractiveCreationPorts } from "./creation-view.ts";
import type { UpdateScope } from "./operations.ts";
import type { BatchUpdateOptions } from "./update-batch.ts";
import type { BatchUpdateNotices } from "./update-single.ts";

import { awaitUpdateNotesChoice } from "#obsidian/note-feature/update-notes-view.ts";

export interface NoteActions {
  switchProfile(file: TFile): Promise<void>;
  updateNote(
    file: TFile,
    options: { itemKey: string; scope: UpdateScope },
  ): Promise<void>;
  overwriteNote(file: TFile, itemKey: string): Promise<void>;
  reimportNote(file: TFile, noteKey: string): Promise<void>;
  updateAll(options?: Pick<BatchUpdateOptions, "create">): Promise<void>;
  updateNotes(note?: ActiveNote): Promise<void>;
}

export function bindNoteActions(
  bridge: Pick<EffectBridge, "runSync" | "runPromiseExit">,
  context: Context.Context<NoteActionServices>,
  ports: {
    creation: InteractiveCreationPorts;
    view: NoteImportView;
    notices: BatchUpdateNotices;
  },
): NoteActions {
  const actionPorts: NoteActionPorts = {
    ...ports.creation,
    batchImport: { view: ports.view, bridge },
    batchUpdate: { notices: ports.notices, view: ports.view, bridge },
    chooseNotes: (note) => awaitUpdateNotesChoice(ports.creation.app, note),
  };
  const runExit = exitOver(bridge, context);
  const run = async <E>(effect: Effect.Effect<void, E, NoteActionServices>) =>
    valueOr(await runExit(effect), undefined);
  return {
    switchProfile: (file) => run(switchProfile(actionPorts, file)),
    updateNote: (file, options) => run(updateNote(actionPorts, file, options)),
    overwriteNote: (file, itemKey) =>
      run(overwriteNote(actionPorts, file, itemKey)),
    reimportNote: (file, noteKey) =>
      run(reimportNote(actionPorts, file, noteKey)),
    updateAll: (options) => run(updateAll(actionPorts, options)),
    updateNotes: (note) => run(updateNotes(actionPorts, note)),
  };
}
