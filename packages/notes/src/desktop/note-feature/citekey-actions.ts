// The citekey editor's note port, filled by the notes feature: a citekey opens
// an Item's Literature Note, or creates it through the interactive flow.
import { Effect, Layer } from "effect";

import { CitekeyNoteActions } from "@zotlit/citations/obsidian/citekey-editor/note-actions.ts";

import type { NoteCreationServices } from "./creation-handle.ts";
import { createNoteInteractively } from "./creation-view.ts";
import type { InteractiveCreationPorts } from "./creation-view.ts";
import { resolveLiteratureNoteWithWarning } from "./update-single.ts";

/** The note port over the creation services the layer is built with. */
export const layerCitekeyNoteActions = (
  creation: InteractiveCreationPorts,
): Layer.Layer<CitekeyNoteActions, never, NoteCreationServices> =>
  Layer.effect(
    CitekeyNoteActions,
    Effect.gen(function* () {
      const context = yield* Effect.context<NoteCreationServices>();
      return CitekeyNoteActions.of({
        pickExisting: resolveLiteratureNoteWithWarning,
        // A citation names one Item, so its note is created at once: the flow
        // asks for a Profile only where no Profile resolves.
        create: (item) =>
          createNoteInteractively(creation, item, { direct: true }).pipe(
            Effect.provideContext(context),
          ),
      });
    }),
  );
