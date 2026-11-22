import type {
  BatchImportPorts,
  BatchImportServices,
  ReimportResult,
} from "#desktop/note-import/batch-import.ts";
import type {
  ActiveNote,
  UpdateNotesChoice,
} from "#obsidian/note-feature/update-notes-view.ts";
import { Effect } from "effect";
import type { App, TFile } from "obsidian";

import { awaitConfirm } from "@zotlit/obsidian-kit/confirm.ts";
import type { Notifier, ProgressCopy } from "@zotlit/obsidian-kit/notifier.ts";
import { reportOutcome, withProgress } from "@zotlit/obsidian-kit/notifier.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";

import type { InteractiveCreationPorts } from "./creation-view.ts";
import type { NoteOperationDiagnostic, UpdateScope } from "./operations.ts";
import { NoteFeature } from "./service.ts";
import { switchNoteProfileInteractively } from "./switch-view.ts";
import { runBatchUpdateAll } from "./update-batch.ts";
import type {
  BatchUpdateOptions,
  BatchUpdatePorts,
  BatchUpdateResult,
  BatchUpdateServices,
} from "./update-batch.ts";
import {
  noteOperationDiagnosticContent,
  updateNoteToast,
  updateWithNotice,
} from "./update-single.ts";

import { isInertTemplateError } from "#core/template/errors.ts";
import { importedNoteProfileErrorNotice } from "#desktop/note-import/batch-import-notices.ts";
import { reimportNoteByKey } from "#desktop/note-import/batch-import.ts";
import { plainNoteError } from "#obsidian/note-feature/errors.ts";
import { missingPartialNotice } from "#obsidian/template/workbench-recovery.ts";

export type NoteActionServices =
  | BatchImportServices
  | BatchUpdateServices
  | NoteFeature
  | Notifier
  | ZoteroPref;

export interface NoteActionPorts extends InteractiveCreationPorts {
  readonly batchImport: BatchImportPorts;
  readonly batchUpdate: BatchUpdatePorts;
  readonly chooseNotes: (
    note?: ActiveNote,
  ) => Effect.Effect<UpdateNotesChoice | null>;
}

const reported = recover(() => Effect.void, Effect.void);

export const switchProfile = Effect.fn("NoteActions.switchProfile")(function* (
  ports: NoteActionPorts,
  file: TFile,
) {
  yield* switchNoteProfileInteractively(ports, file);
});

export const updateNote = Effect.fn("NoteActions.updateNote")(function* (
  ports: NoteActionPorts,
  file: TFile,
  options: { itemKey: string; scope: UpdateScope },
) {
  yield* reported(
    updateWithNotice(
      file,
      { indexedKey: options.itemKey, scope: options.scope },
      updateNoteToast(options.scope, { app: ports.app }),
    ),
  );
});

export const overwriteNote = Effect.fn("NoteActions.overwriteNote")(function* (
  ports: NoteActionPorts,
  file: TFile,
  itemKey: string,
) {
  const yes = yield* awaitConfirm(
    {
      title: m.modal_overwrite_note_title(),
      content: m.modal_overwrite_note_desc(),
      action: m.modal_overwrite_note_confirm(),
      destructive: true,
    },
    ports.app,
  );
  if (!yes) return;
  yield* reported(
    withProgress(
      (yield* NoteFeature).overwriteNote(file, itemKey),
      overwriteNoteToast({ app: ports.app }),
    ),
  );
});

export const reimportNote = Effect.fn("NoteActions.reimportNote")(function* (
  ports: NoteActionPorts,
  file: TFile,
  noteKey: string,
) {
  const yes = yield* awaitConfirm(
    {
      title: m.modal_reimport_note_title(),
      content: m.modal_reimport_note_desc(),
      action: m.modal_reimport_note_confirm(),
      destructive: true,
    },
    ports.app,
  );
  if (!yes) return;
  yield* reported(
    withProgress(
      reimportNoteByKey(ports.batchImport, noteKey, file),
      reimportNoteToast({ app: ports.app, path: file.path }),
    ),
  );
});

export const updateAll = Effect.fn("NoteActions.updateAll")(function* (
  ports: NoteActionPorts,
  options: Pick<BatchUpdateOptions, "create"> = {},
) {
  yield* reportOutcome(runBatchUpdateAll(ports.batchUpdate, options), {
    success: batchUpdateAllNotice,
    error: () => undefined,
  });
});

export const updateNotes = Effect.fn("NoteActions.updateNotes")(function* (
  ports: NoteActionPorts,
  active?: ActiveNote,
) {
  const choice = yield* ports.chooseNotes(active);
  if (choice === null) return;
  if (choice.target === "note") {
    const { file, itemKey } = choice.note;
    yield* updateNote(ports, file, { itemKey, scope: "full" });
    return;
  }
  yield* updateAll(ports, { create: choice.create });
});

export function reimportNoteToast(options: {
  app: App;
  path: string;
}): ProgressCopy<ReimportResult> {
  return {
    loading: m.notice_reimporting_note(),
    success: reimportNoteNotice,
    error: (e) =>
      missingPartialNotice(e, options) ??
      (isInertTemplateError(e)
        ? e.message
        : (importedNoteProfileErrorNotice(e, options) ??
          m.notice_reimport_note_failed())),
  };
}

function reimportNoteNotice(result: ReimportResult): string {
  switch (result.outcome) {
    case "db-unavailable":
      return m.batch_update_db_unavailable();
    case "not-found":
      return m.notice_protocol_item_not_found();
    case "created":
    case "overwritten":
      return m.notice_reimported_note();
    case "skipped":
      return m.notice_reimport_note_skipped();
  }
}

export function overwriteNoteToast(options: { app: App }): ProgressCopy<{
  diagnostic?: NoteOperationDiagnostic;
}> {
  return {
    loading: m.notice_overwriting_note(),
    success: (result) =>
      result.diagnostic
        ? noteOperationDiagnosticContent(options.app, result.diagnostic)
        : m.notice_overwrote_note(),
    error: (failure) => {
      const e = plainNoteError(failure);
      return (
        missingPartialNotice(e, options) ??
        (isInertTemplateError(e) ? e.message : m.notice_overwrite_note_failed())
      );
    },
  };
}

export function batchUpdateAllNotice(
  result: BatchUpdateResult,
): string | undefined {
  switch (result.outcome) {
    case "db-unavailable":
      return m.batch_update_db_unavailable();
    case "empty-selection":
      return m.batch_update_all_empty();
    case "no-library-in-scope":
      return m.batch_all_no_library_in_scope();
    default:
      return undefined;
  }
}
