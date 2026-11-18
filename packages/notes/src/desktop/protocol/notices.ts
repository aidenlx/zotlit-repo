// Outcome notices of the note links: what each refused link, early exit or
// failure of a link-started run tells the user.

import type { BatchUpdateResult } from "#desktop/note-feature/update-batch.ts";
import { Effect } from "effect";
import type { App } from "obsidian";

import { Notifier, reportOutcome } from "@zotlit/obsidian-kit/notifier.ts";
import type {
  NoticeMessage,
  OutcomeCopy,
} from "@zotlit/obsidian-kit/notifier.ts";
import { unknownProfileDiagnostic } from "@zotlit/obsidian-kit/profile-stamp.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { linkOutcomeNotices } from "@zotlit/plugin-services/obsidian/protocol/notices.ts";

import { NoteLinkOutcome } from "./outcome.ts";

import { noteOperationDiagnosticNotice } from "#desktop/note-feature/update-single.ts";
import {
  batchImportAllToast,
  batchImportToast,
  importNotices,
} from "#desktop/note-import/batch-import-notices.ts";

/**
 * Show the notice of a note link's outcome: a refusal shows its message; a
 * run reports its result for 2 s or its failure for 4 s, as
 * {@link reportOutcome} does. An ignored link and an open show none.
 */
export const showNoteLinkOutcome = Effect.fn("protocol.showNoteLinkOutcome")(
  function* (outcome: NoteLinkOutcome, options: { readonly app?: App }) {
    const notifier = yield* Notifier;
    const show = (message: NoticeMessage) =>
      Effect.asVoid(notifier.show(message));
    yield* NoteLinkOutcome.$match(outcome, {
      ...linkOutcomeNotices(show, Effect.void),
      UnknownProfile: ({ text }) =>
        show(noteOperationDiagnosticNotice(unknownProfileDiagnostic(text))),
      UpdateMany: ({ exit }) => reportOutcome(exit, batchUpdateToast),
      UpdateAll: ({ exit }) => reportOutcome(exit, updateAllToast),
      ImportNotes: ({ exit }) =>
        reportOutcome(exit, importNotices(batchImportToast(options))),
      ImportAllNotes: ({ exit }) =>
        reportOutcome(exit, importNotices(batchImportAllToast(options))),
    });
  },
);

/** A batch update's notices: the early-exit outcomes; a failure shows none. */
const batchUpdateToast: OutcomeCopy<BatchUpdateResult> = {
  success: batchUpdateNotice,
  error: () => undefined,
};

function batchUpdateNotice(result: BatchUpdateResult): string | undefined {
  switch (result.outcome) {
    case "db-unavailable":
      return m.batch_update_db_unavailable();
    case "empty-selection":
    case "not-found":
      return m.notice_protocol_item_not_found();
    default:
      return undefined;
  }
}

function updateAllNotice(result: BatchUpdateResult): string | undefined {
  switch (result.outcome) {
    case "db-unavailable":
      return m.batch_update_db_unavailable();
    case "empty-selection":
      return m.batch_update_all_empty();
    case "no-library-in-scope":
      return m.batch_all_no_library_in_scope();
    case "unavailable-target":
      return m.batch_all_library_unavailable();
    case "collection-not-found":
      return m.notice_collection_not_found();
    default:
      return undefined;
  }
}

/** An update-all link's notices: the early-exit outcomes; a failure shows none. */
const updateAllToast: OutcomeCopy<BatchUpdateResult> = {
  success: updateAllNotice,
  error: () => undefined,
};
