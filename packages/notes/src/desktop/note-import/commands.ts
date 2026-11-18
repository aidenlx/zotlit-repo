// The note import commands: the Notifier reports each import's outcome, and
// the import ends with that outcome.
import { Effect, Layer } from "effect";
import type { Context } from "effect";
import type { App } from "obsidian";

import { withOutcome } from "@zotlit/obsidian-kit/notifier.ts";
import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import {
  batchImportAllToast,
  childImportToast,
  importNotices,
} from "./batch-import-notices.ts";
import { runBatchImportAll, runChildImportByKey } from "./batch-import.ts";
import type { BatchImportPorts, BatchImportServices } from "./batch-import.ts";
import type { NoteImportView } from "./view.ts";

import { withLiteratureNote } from "#desktop/note-feature/actions.ts";

/** The services a note import command reads. */
type ImportCommandServices = BatchImportServices | Notifier;

/**
 * Import all child and standalone notes in the Library Scope. Answers the
 * import's outcome, or fails with what failed; the notice reports either.
 * An interrupt (unload) ends it with no outcome and no notice.
 */
export const importAllNotes = Effect.fn("NoteImport.importAllNotes")(function* (
  ports: BatchImportPorts,
  app: App,
) {
  return yield* withOutcome(
    runBatchImportAll(ports),
    importNotices(batchImportAllToast({ app })),
  );
});

/**
 * Import the child notes of the item `indexedKey` names, as
 * {@link importAllNotes} does: `null` when the key names no live item.
 */
export const importChildNotes = Effect.fn("NoteImport.importChildNotes")(
  function* (ports: BatchImportPorts, app: App, indexedKey: string) {
    return yield* withOutcome(
      runChildImportByKey(ports, indexedKey),
      importNotices(childImportToast({ app })),
    );
  },
);

/**
 * Start a note import command from a callback over `context`. Its notice
 * reported a failure; a defect still surfaces.
 */
export const importStarter =
  (
    bridge: Pick<EffectBridge, "runAndForget">,
    context: Context.Context<ImportCommandServices>,
  ) =>
  <A, E>(command: Effect.Effect<A, E, ImportCommandServices>): void =>
    bridge.runAndForget(Effect.ignore(Effect.provideContext(command, context)));

/**
 * Register Import all notes and Import child notes. Each runs on the layer's
 * Scope, and its notice reports the outcome; unload
 * interrupts a run still going.
 */
export const layerNoteImportCommands = (ports: {
  readonly view: NoteImportView;
}): Layer.Layer<never, never, PluginHost | ImportCommandServices> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const host = yield* PluginHost;
      const bridge = yield* scopedBridge;
      const start = importStarter(
        bridge,
        yield* Effect.context<ImportCommandServices>(),
      );
      const importPorts = { view: ports.view, bridge };
      yield* host.addCommand({
        id: "import-child-notes",
        name: m.command_import_child_notes_name(),
        editorCheckCallback(checking, _editor, ctx) {
          return withLiteratureNote(host, { ctx, checking }, (_file, itemKey) =>
            start(importChildNotes(importPorts, host.app, itemKey)),
          );
        },
      });
      yield* host.addCommand({
        id: "import-all-notes",
        name: m.command_import_all_notes_name(),
        callback: () => start(importAllNotes(importPorts, host.app)),
      });
    }),
  );
