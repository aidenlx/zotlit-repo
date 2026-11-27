import type { BatchRunResult } from "#obsidian/batch/batch-run.ts";
import type { App } from "obsidian";

import type {
  NoticeMessage,
  OutcomeCopy,
} from "@zotlit/obsidian-kit/notifier.ts";
import { profileRecoveryNotice } from "@zotlit/obsidian-kit/profile-recovery.ts";
import * as toast from "@zotlit/obsidian-kit/toast.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { BatchImportResult } from "./batch-import.ts";
import { NoteImportProfileError } from "./service.ts";

import { ProfileAnnotationError } from "#obsidian/template/service.ts";

export function importedNoteProfileErrorNotice(
  error: unknown,
  options: { app?: App; path?: string } = {},
): NoticeMessage | undefined {
  if (
    !(
      error instanceof NoteImportProfileError ||
      error instanceof ProfileAnnotationError
    )
  )
    return undefined;
  return options.app &&
    error.diagnostic.code === "unknown-literature-note-profile"
    ? profileRecoveryNotice(options.app, error.diagnostic, {
        path: options.path,
        imported:
          error instanceof NoteImportProfileError ? error.imported : true,
      })
    : error.message;
}

function importErrorNotice(
  _message: string,
  error: unknown,
  options: { app?: App },
): NoticeMessage {
  return (
    importedNoteProfileErrorNotice(error, options) ?? m.batch_import_failed()
  );
}
type ImportErrorNotice = (message: string, error: unknown) => NoticeMessage;

export function batchImportNotice(
  result: BatchImportResult,
): string | undefined {
  switch (result.outcome) {
    case "db-unavailable":
      return m.batch_update_db_unavailable();
    case "empty-selection":
      return m.notice_protocol_item_not_found();
    case "not-found":
      return m.batch_import_not_found({ count: result.count });
    case "single":
      if (result.write === "created") {
        return m.notice_imported_note({ title: result.title });
      }
      if (result.write === "overwritten") {
        return m.notice_updated_imported_note({ title: result.title });
      }
      return m.notice_reimport_note_skipped();
    case "batch-modal":
    case "cancelled":
      return undefined;
    default:
      return undefined;
  }
}

export function batchImportAllNotice(
  result: BatchImportResult,
): string | undefined {
  switch (result.outcome) {
    case "empty-selection":
      return m.batch_import_all_empty();
    case "no-library-in-scope":
      return m.batch_all_no_library_in_scope();
    case "unavailable-target":
      return m.batch_all_library_unavailable();
    case "collection-not-found":
      return m.notice_collection_not_found();
    default:
      return batchImportNotice(result);
  }
}

export function batchImportAllToast(options: { app?: App } = {}): {
  success: (result: BatchImportResult) => string | undefined;
  error: ImportErrorNotice;
} {
  return {
    success: batchImportAllNotice,
    error: (message, error) => importErrorNotice(message, error, options),
  };
}

export function batchImportToast(options: { app?: App } = {}): {
  success: (result: BatchImportResult) => string | undefined;
  error: ImportErrorNotice;
} {
  return {
    success: batchImportNotice,
    error: (message, error) => importErrorNotice(message, error, options),
  };
}

export function childImportToast(options: { app?: App } = {}): {
  success: (result: BatchImportResult | null) => string | undefined;
  error: ImportErrorNotice;
} {
  return {
    success: (result) =>
      result ? batchImportNotice(result) : m.notice_protocol_item_not_found(),
    error: (message, error) => importErrorNotice(message, error, options),
  };
}

export function importNotices<A>(copy: {
  success: (result: A) => NoticeMessage | undefined;
  error: (message: string, error: unknown) => NoticeMessage | undefined;
}): OutcomeCopy<A> {
  return {
    success: copy.success,
    error: (error) => copy.error(toast.formatErrorMessage(error), error),
  };
}

export function importRunSummary(
  notFound: () => number,
): (
  result: BatchRunResult,
  state: { cancelled: boolean; aborted: boolean },
) => string {
  return (result, state) => {
    const { created, updated, skipped, failed } = result;
    if (state.aborted) {
      return m.batch_import_aborted({ created, updated, skipped, failed });
    }
    if (state.cancelled) {
      return m.batch_import_summary_cancelled({
        created,
        updated,
        skipped,
        failed,
      });
    }
    return m.batch_import_summary({
      created,
      updated,
      skipped,
      failed,
      notFound: notFound(),
    });
  };
}
