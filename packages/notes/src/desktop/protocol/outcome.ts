// What one note link or pushed request ended with: the notice it shows reads
// it, and so do the tests.

import type { BatchUpdateResult } from "#desktop/note-feature/update-batch.ts";
import type { BatchImportResult } from "#desktop/note-import/batch-import.ts";
import { Data } from "effect";
import type { Exit } from "effect";

import type { LinkOutcomeVariants } from "@zotlit/plugin-services/obsidian/protocol/outcome.ts";

export type NoteLinkOutcome = Data.TaggedEnum<
  LinkOutcomeVariants & {
    /** The `profileId` text names neither `default` nor a Profile ID. */
    UnknownProfile: { readonly text: string };
    /** The batch update of an `update-many` link or a pushed update ended. */
    UpdateMany: { readonly exit: Exit.Exit<BatchUpdateResult, unknown> };
    /** The library-wide update of an `update-all` link ended. */
    UpdateAll: { readonly exit: Exit.Exit<BatchUpdateResult, unknown> };
    /** The import of an `import-note(s)` link or a pushed import ended. */
    ImportNotes: { readonly exit: Exit.Exit<BatchImportResult, unknown> };
    /** The library-wide import of an `import-all-notes` link ended. */
    ImportAllNotes: { readonly exit: Exit.Exit<BatchImportResult, unknown> };
  }
>;

export const NoteLinkOutcome = Data.taggedEnum<NoteLinkOutcome>();
