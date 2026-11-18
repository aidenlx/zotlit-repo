// What one Template Workbench link ended with: the notice it shows reads it,
// and so do the tests.
import { Data } from "effect";

import type { LinkOutcomeVariants } from "@zotlit/plugin-services/obsidian/protocol/outcome.ts";

export type WorkbenchLinkOutcome = Data.TaggedEnum<
  LinkOutcomeVariants & {
    /** The clipboard Profile opened in the workbench. */
    ProfileOpened: object;
    /** The user closed the Profile import without a document. */
    ProfileImportCancelled: object;
    /** The clipboard Profile import or its open failed. */
    ProfileImportFailed: object;
  }
>;

export const WorkbenchLinkOutcome = Data.taggedEnum<WorkbenchLinkOutcome>();
