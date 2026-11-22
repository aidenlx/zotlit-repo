import { Effect } from "effect";

import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";

import type { NoteCitations } from "./citations-handle.ts";
import type { NoteCreation } from "./creation-handle.ts";
import type { NoteFeatureHandle } from "./operations.ts";
import type { NoteFeature } from "./service.ts";

import { plainNoteError } from "#obsidian/note-feature/errors.ts";

export function bindNoteFeature(
  bridge: Pick<EffectBridge, "runPromise">,
  service: NoteFeature["Service"],
  edges: NoteCitations & NoteCreation,
): NoteFeatureHandle {
  const run = <A, E>(effect: Effect.Effect<A, E>) =>
    bridge.runPromise(
      Effect.mapError(effect, (error) => plainNoteError(error)),
    );
  return {
    ...edges,
    createNote: (item, options) => run(service.createNote(item, options)),
    updateNote: (file, options) => run(service.updateNote(file, options)),
    overwriteNote: (file, indexedKey, options) =>
      run(service.overwriteNote(file, indexedKey, options)),
    replacedKeys: (file) => run(service.replacedKeys(file)),
    getImportedNotesForItem: (indexedKey) =>
      run(service.getImportedNotesForItem(indexedKey)),
  };
}
