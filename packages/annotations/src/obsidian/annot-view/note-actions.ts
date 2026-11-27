import type {
  AnnotationRecord,
  AnnotationSource,
} from "#obsidian/annotation-repository/service.ts";
import type { ExcerptSummary } from "#obsidian/excerpt-image/contract.ts";
import type { Effect } from "effect";
import { Context } from "effect";

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

export interface ProfileAnnotationProblem {
  readonly message: string;
  readonly diagnostic:
    | UnknownProfileDiagnostic
    | { readonly code: "missing-literature-note-template" };
}

export type AnnotationInsertOutcome =
  | { kind: "no-note" }
  | { kind: "unavailable" }
  | { kind: "source-unavailable" }
  | { kind: "fallback"; landed: boolean }
  | { kind: "inserted"; summary: ExcerptSummary }
  | { kind: "profile-error"; error: ProfileAnnotationProblem; landed: boolean }
  | { kind: "failed" }
  | { kind: "cancelled" };

export type AnnotationCitation =
  | { kind: "citation"; text: string }
  | { kind: "no-citation-key" }
  | { kind: "not-in-database" };

export interface InertCitationTemplate {
  kind: "inert-template";
  message: string;
}

export class AnnotationNoteActions extends Context.Service<
  AnnotationNoteActions,
  {
    citation(
      key: string,
    ): Effect.Effect<AnnotationCitation | InertCitationTemplate, unknown>;
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
