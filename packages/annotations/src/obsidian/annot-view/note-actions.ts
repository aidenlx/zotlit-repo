// What the annotation surfaces ask of the notes: insert an Annotation into a
// note, and render its page-pinned citation. The notes feature provides the
// layer; the cards and the Mark Popup read the tag.

import type {
  AnnotationRecord,
  AnnotationSource,
} from "#obsidian/annotation-repository/service.ts";
import type { ExcerptSummary } from "#obsidian/excerpt-image/contract.ts";
import { Context } from "effect";
import type { Effect } from "effect";

import type { UnknownProfileDiagnostic } from "@zotlit/obsidian-kit/profile-stamp.ts";

import type { Placement } from "./async-insert.ts";

export interface AnnotationSnapshot {
  source: AnnotationSource | null;
  sourceScope: string | null;
}
interface AnnotationInsertTarget {
  valid: () => boolean;
  commit(text: string, placement?: Placement): boolean;
}
/**
 * The annotation an insert takes: a record the caller holds with its source,
 * or a search hit that the insert reads from the repository.
 */
export type AnnotationInsertSubject =
  | {
      annotation: AnnotationRecord;
      snapshot: AnnotationSnapshot;
    }
  | {
      hit: { key: string; attachmentKey: string; itemKey: string };
    };
export type AnnotationInsertRequest = AnnotationInsertSubject & {
  target: AnnotationInsertTarget;
  notePath: string;
  placement?: Placement;
};

/**
 * A Profile that cannot supply an Annotation's presentation: its message, and
 * the diagnostic that says whether a Profile switch recovers it.
 */
export interface ProfileAnnotationProblem {
  readonly message: string;
  readonly diagnostic:
    | UnknownProfileDiagnostic
    | { readonly code: "missing-literature-note-template" };
}

/** How one asynchronous annotation insert ended. */
export type AnnotationInsertOutcome =
  /** No note in Source mode or Live Preview takes the insert. */
  | { kind: "no-note" }
  /** The selected search hit is no longer in the repository. */
  | { kind: "unavailable" }
  /** The annotation's source is gone, so nothing is inserted. */
  | { kind: "source-unavailable" }
  /** The template could not render, and the fallback text took its place. */
  | { kind: "fallback"; landed: boolean }
  | { kind: "inserted"; summary: ExcerptSummary }
  /** A Profile error: the annotation's own text took the template's place. */
  | { kind: "profile-error"; error: ProfileAnnotationProblem; landed: boolean }
  /** The insert failed; the log keeps the error. */
  | { kind: "failed" }
  /** The target went away, or a newer insert took its place. */
  | { kind: "cancelled" };

/** What "Copy citation" puts on the clipboard, or why it has nothing to put. */
export type AnnotationCitation =
  | { kind: "citation"; text: string }
  /** The parent item carries no citation key, or the Annotation has no parent item. */
  | { kind: "no-citation-key" }
  /** The Zotero database holds no Annotation under the key. */
  | { kind: "not-in-database" };

/**
 * A citation the Citation Template cannot render while the JavaScript
 * Templates gate keeps it inert; `message` names it for the researcher.
 */
export interface InertCitationTemplate {
  kind: "inert-template";
  message: string;
}

export class AnnotationNoteActions extends Context.Service<
  AnnotationNoteActions,
  {
    /**
     * Render one Annotation's page-pinned citation.
     *
     * @param key the Annotation's Indexed Key.
     */
    citation(
      key: string,
    ): Effect.Effect<AnnotationCitation | InertCitationTemplate, unknown>;
    /** Insert one Annotation into the note the request's target names. */
    insert(
      options: AnnotationInsertRequest,
    ): Effect.Effect<AnnotationInsertOutcome, unknown>;
  }
>()("zotlit/annotations/AnnotationNoteActions") {}

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    AnnotationNoteActions: AnnotationNoteActions;
  }
}
