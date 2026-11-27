import { Cause, Effect, Exit } from "effect";
import type { PaneType } from "obsidian";

import {
  openGesture,
  pdfPickerReader,
} from "@zotlit/annotations/desktop/attachment-open/actions.ts";
import type { AttachmentOpenDeps } from "@zotlit/annotations/desktop/attachment-open/actions.ts";
import {
  openAttachments,
  withFixedPane,
} from "@zotlit/annotations/desktop/attachment-open/open-attachments.ts";
import type { Item } from "@zotlit/db";
import type { InteractiveCreationPorts } from "@zotlit/notes/desktop/note-feature/creation-view.ts";
import { openLiteratureNote } from "@zotlit/notes/desktop/note-feature/navigation.ts";
import { viewRuntime } from "@zotlit/obsidian-kit/view-atoms.ts";
import type { ViewRegistryHandle } from "@zotlit/obsidian-kit/view-atoms.ts";

export interface NoteResultDeps {
  registry: ViewRegistryHandle;
  creation: InteractiveCreationPorts;
}

export function openOrCreateNote(
  deps: NoteResultDeps,
  options: { indexedKey: string; item: Item; newPane: PaneType | boolean },
): Promise<void> {
  const result = Promise.withResolvers<void>();
  const command = viewRuntime.fn((_input: void) =>
    openLiteratureNote(deps.creation, options.indexedKey, {
      source: "interactive",
      item: options.item,
      paneType: options.newPane,
    }).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
            result.reject(Cause.squash(exit.cause));
          else result.resolve();
        }),
      ),
    ),
  );
  const release = deps.registry.mount(command);
  deps.registry.set(command, undefined);
  return result.promise.finally(release);
}

export async function openItemPdf(
  deps: AttachmentOpenDeps,
  indexedKey: string,
  pane: PaneType | boolean,
): Promise<void> {
  const pdfs = await deps.attachments.literatureNoteAttachments(indexedKey);
  if (!pdfs) return;
  openAttachments(pdfs.attachments, {
    reader: withFixedPane(
      pdfPickerReader(openGesture(deps.opener, deps.bridge.runAndForget), pdfs),
      pane,
    ),
    app: deps.app,
  });
}
