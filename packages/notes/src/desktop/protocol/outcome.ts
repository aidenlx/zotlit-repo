import type { BatchUpdateResult } from "#desktop/note-feature/update-batch.ts";
import type { BatchImportResult } from "#desktop/note-import/batch-import.ts";
import type { Exit } from "effect";
import { Data } from "effect";

import type { LinkOutcomeVariants } from "@zotlit/plugin-services/obsidian/protocol/outcome.ts";

export type NoteLinkOutcome = Data.TaggedEnum<
  LinkOutcomeVariants & {
    UnknownProfile: { readonly text: string };
    UpdateMany: { readonly exit: Exit.Exit<BatchUpdateResult, unknown> };
    UpdateAll: { readonly exit: Exit.Exit<BatchUpdateResult, unknown> };
    ImportNotes: { readonly exit: Exit.Exit<BatchImportResult, unknown> };
    ImportAllNotes: { readonly exit: Exit.Exit<BatchImportResult, unknown> };
  }
>;

export const NoteLinkOutcome = Data.taggedEnum<NoteLinkOutcome>();
