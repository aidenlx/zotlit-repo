import { Effect } from "effect";
import type { App, TFile } from "obsidian";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { withProgress } from "@zotlit/obsidian-kit/notifier.ts";
import type {
  NoticeMessage,
  ProgressCopy,
} from "@zotlit/obsidian-kit/notifier.ts";
import { profileRecoveryNotice } from "@zotlit/obsidian-kit/profile-recovery.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type {
  CreateNoteResult,
  NoteOperationDiagnostic,
  UpdateResult,
  UpdateScope,
} from "./operations.ts";
import { NoteFeature } from "./service.ts";
import type { UpdateNoteOptions } from "./write-pipeline.ts";

import { EmptyFilenameError } from "#core/note-feature/filename.ts";
import { isInertTemplateError } from "#core/template/errors.ts";
import { plainNoteError } from "#obsidian/note-feature/errors.ts";
import { missingPartialNotice } from "#obsidian/template/workbench-recovery.ts";

export interface UpdateNoteCopy extends ProgressCopy<UpdateResult> {
  readonly loading: string;
  readonly success: (result: UpdateResult) => NoticeMessage;
  readonly error: (error: unknown) => NoticeMessage;
}

export function updateNoteToast(
  scope: UpdateScope,
  options: { app?: App } = {},
): UpdateNoteCopy {
  const diagnosticContent = (diagnostic: NoteOperationDiagnostic) =>
    options.app
      ? noteOperationDiagnosticContent(options.app, diagnostic)
      : noteOperationDiagnosticNotice(diagnostic);
  const error = (failure: unknown): NoticeMessage => {
    const cause = plainNoteError(failure);
    return (
      missingPartialNotice(cause, options) ??
      (isInertTemplateError(cause)
        ? cause.message
        : m.notice_update_note_failed())
    );
  };
  if (scope === "metadata") {
    return {
      loading: m.notice_updating_note_metadata(),
      success: (result) =>
        result.diagnostic
          ? diagnosticContent(result.diagnostic)
          : m.notice_updated_note_metadata(),
      error,
    };
  }
  return {
    loading: m.notice_updating_note(),
    success: (result) =>
      result.diagnostic
        ? diagnosticContent(result.diagnostic)
        : result.bodyUpdated
          ? m.notice_updated_note()
          : result.noManagedBlock
            ? m.notice_updated_note_no_managed_block()
            : m.notice_updated_note_no_region(),
    error,
  };
}

export interface BatchUpdateNotices {
  readonly updateToast: (scope: UpdateScope) => UpdateNoteCopy;
  readonly createToast: ProgressCopy<CreateNoteResult>;
  readonly runFailed: (error: unknown) => NoticeMessage;
}

export function batchUpdateNotices(app: App): BatchUpdateNotices {
  return {
    updateToast: (scope) => updateNoteToast(scope, { app }),
    createToast: createNoteToast({ app }, plainNoteError),
    runFailed: (error) => {
      const cause = plainNoteError(error);
      return (
        missingPartialNotice(cause, { app }) ??
        (isInertTemplateError(cause)
          ? cause.message
          : m.batch_update_run_failed())
      );
    },
  };
}

export const updateWithNotice = Effect.fnUntraced(function* (
  file: TFile,
  options: UpdateNoteOptions,
  copy: ProgressCopy<UpdateResult>,
) {
  yield* withProgress(
    (yield* NoteFeature).updateNote(file, options),
    copy,
  ).pipe(Effect.ignore);
});

export const createWithNotice = Effect.fnUntraced(function* <E, R>(
  create: Effect.Effect<CreateNoteResult, E, R>,
  options: { app?: App; created?: (file: TFile) => string } = {},
) {
  const result = yield* withProgress(
    create,
    createNoteToast(options, plainNoteError),
  ).pipe(recover(() => Effect.void, Effect.void));
  return result?.outcome === "created" ? result.file : null;
});

export function createNoteToast(
  options: { app?: App; created?: (file: TFile) => string },
  plainError: (error: unknown) => unknown = (error) => error,
): ProgressCopy<CreateNoteResult> & {
  success: (result: CreateNoteResult) => NoticeMessage;
  error: (error: unknown) => NoticeMessage;
} {
  return {
    loading: m.notice_creating_note(),
    success: (result) => createNoteSuccessNotice(result, options),
    error: (error) => {
      const e = plainError(error);
      return (
        missingPartialNotice(e, options) ??
        (e instanceof EmptyFilenameError || isInertTemplateError(e)
          ? e.message
          : m.notice_create_note_failed())
      );
    },
  };
}

function createNoteSuccessNotice(
  result: CreateNoteResult,
  options: { app?: App; created?: (file: TFile) => string },
): NoticeMessage {
  if (result.outcome === "created" && options.created)
    return options.created(result.file);
  if (
    result.outcome === "refused" &&
    result.diagnostic.code === "unknown-literature-note-profile" &&
    options.app
  )
    return profileRecoveryNotice(options.app, result.diagnostic);
  return createNoteNotice(result);
}

export function createNoteNotice(result: CreateNoteResult): string {
  if (result.outcome === "created") return m.notice_created_note();
  const { diagnostic } = result;
  switch (diagnostic.code) {
    case "literature-note-exists":
      return m.notice_create_note_exists({ path: diagnostic.paths[0] });
    case "duplicate-literature-notes":
      return m.notice_create_note_duplicates({
        paths: diagnostic.paths.join(", "),
      });
    case "unknown-literature-note-profile":
    case "literature-note-profile-conflict":
    case "missing-literature-note-template":
    case "literature-note-template-conversion-required":
    case "managed-frontmatter-refused":
    case "literature-note-key-changed":
    case "literature-note-profile-changed":
      return noteOperationDiagnosticNotice(diagnostic);
  }
}

export function noteOperationDiagnosticNotice(
  diagnostic: NoteOperationDiagnostic,
): string {
  switch (diagnostic.code) {
    case "unknown-literature-note-profile":
      return m.notice_literature_note_profile_unknown({
        stamp: diagnostic.stamp,
      });
    case "literature-note-profile-conflict":
      return m.notice_literature_note_profile_conflict();
    case "missing-literature-note-template":
      return m.notice_literature_note_template_missing({
        document: diagnostic.document,
      });
    case "literature-note-template-conversion-required":
      return m.notice_literature_note_template_conversion_required();
    case "managed-frontmatter-refused":
      return m.notice_managed_frontmatter_refused({
        failures: diagnostic.failures
          .map(({ message, hint }) => `${message} ${hint}`)
          .join(" "),
      });
    case "literature-note-key-changed":
      return m.notice_literature_note_key_changed();
    case "literature-note-profile-changed":
      return m.notice_literature_note_profile_changed();
  }
}

export function noteOperationDiagnosticContent(
  app: App,
  diagnostic: NoteOperationDiagnostic,
): NoticeMessage {
  return diagnostic.code === "unknown-literature-note-profile"
    ? profileRecoveryNotice(app, diagnostic)
    : noteOperationDiagnosticNotice(diagnostic);
}

export function duplicateLiteratureNoteWarning(
  notes: readonly Pick<TFile, "path">[],
): string | null {
  if (notes.length < 2) return null;
  return m.notice_duplicate_literature_notes({
    paths: notes.map((file) => file.path).join(", "),
    selected: notes[0]!.path,
  });
}

export function resolveLiteratureNoteWithWarning(
  notes: readonly TFile[],
): TFile | undefined {
  const warning = duplicateLiteratureNoteWarning(notes);
  if (warning) new BaseNotice(warning);
  return notes[0];
}
