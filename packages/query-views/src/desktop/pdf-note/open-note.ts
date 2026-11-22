import type { Scope, Stream } from "effect";
import { Effect } from "effect";
import type { View, WorkspaceLeaf } from "obsidian";

import type { ReaderSession } from "@zotlit/annotations/core/reader-session/session.ts";
import type { InteractiveCreationPorts } from "@zotlit/notes/desktop/note-feature/creation-view.ts";
import { openLiteratureNote } from "@zotlit/notes/desktop/note-feature/navigation.ts";
import { viewRuntime } from "@zotlit/obsidian-kit/view-atoms.ts";
import type { ViewServices } from "@zotlit/obsidian-kit/view-atoms.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";

export type PdfSessions = Stream.Stream<ReadonlyMap<View, ReaderSession>>;

export const pdfNoteOpens = viewRuntime.fn(
  (effect: Effect.Effect<void, unknown, ViewServices | Scope.Scope>) =>
    effect.pipe(
      Effect.scoped,
      recover(
        (error) =>
          Effect.logWarning(
            "The PDF view could not open its literature note",
          ).pipe(Effect.annotateLogs({ error })),
        Effect.void,
      ),
      withLogCategory("pdf-note"),
    ),
  { concurrent: true },
);

export const openNoteBeside = Effect.fn("PdfNote.openNoteBeside")(function* (
  creation: InteractiveCreationPorts,
  leaf: WorkspaceLeaf,
  itemKey: string,
) {
  yield* openLiteratureNote(creation, itemKey, {
    source: "interactive",
    beside: leaf,
  });
});
