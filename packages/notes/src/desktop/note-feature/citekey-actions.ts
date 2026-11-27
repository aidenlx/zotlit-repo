import { Effect, Layer } from "effect";

import { CitekeyNoteActions } from "@zotlit/citations/obsidian/citekey-editor/note-actions.ts";

import type { NoteCreationServices } from "./creation-handle.ts";
import { createNoteInteractively } from "./creation-view.ts";
import type { InteractiveCreationPorts } from "./creation-view.ts";
import { resolveLiteratureNoteWithWarning } from "./update-single.ts";

export const layerCitekeyNoteActions = (
  creation: InteractiveCreationPorts,
): Layer.Layer<CitekeyNoteActions, never, NoteCreationServices> =>
  Layer.effect(
    CitekeyNoteActions,
    Effect.gen(function* () {
      const context = yield* Effect.context<NoteCreationServices>();
      return CitekeyNoteActions.of({
        pickExisting: resolveLiteratureNoteWithWarning,
        create: Effect.fn("CitekeyNoteActions.create")((item) =>
          createNoteInteractively(creation, item, { direct: true }).pipe(
            Effect.provideContext(context),
          ),
        ),
      });
    }),
  );
