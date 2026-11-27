import type {
  Citation,
  CitationKeyResolution,
  DocumentCitationError,
} from "#obsidian/citation-index/service.ts";
import type { DocumentPresentationFailure } from "#obsidian/pandoc/document-presentation.ts";
import type { PandocEngineStatus } from "#obsidian/pandoc/service.ts";

import type { ReferenceEntry } from "./entries.ts";
import { buildReferenceEntries } from "./entries.ts";

export type ReferencesListMode =
  | { kind: "minimal" }
  | {
      kind: "bibliography";
      hasEntryMarkers: boolean;
      entrySerials: boolean;
    };

export type ReferencesCopyBlock =
  | "no-note"
  | "no-references"
  | "pending"
  | "unavailable"
  | "failed"
  | "errors";

export interface ReferencesCopyTarget {
  path: string;
  generation: number;
}

export type ReferencesCopyState =
  | { kind: "ready"; target: ReferencesCopyTarget }
  | { kind: "blocked"; reason: ReferencesCopyBlock };

export type ReferencesFormatting =
  | "pending"
  | "complete"
  | "unavailable"
  | "failed";

export interface ReferencesState {
  entries: readonly ReferenceEntry[];
  listMode: ReferencesListMode;
  engine: PandocEngineStatus;
  engineHintDismissed: boolean;
  formattingFailed: boolean;
  documentPresentationError: DocumentPresentationFailure | null;
  dbReady: boolean;
  citekeyResolution: CitationKeyResolution;
  copy: ReferencesCopyState;
}

export function referencesCopyState({
  path,
  generation,
  entries,
  formatting,
}: {
  path: string | null;
  generation: number;
  entries: readonly ReferenceEntry[];
  formatting: ReferencesFormatting;
}): ReferencesCopyState {
  if (path === null) return { kind: "blocked", reason: "no-note" };
  if (entries.length === 0) return { kind: "blocked", reason: "no-references" };
  if (formatting !== "complete") {
    return { kind: "blocked", reason: formatting };
  }
  return entries.every((entry) => entry.kind === "rendered")
    ? { kind: "ready", target: { path, generation } }
    : { kind: "blocked", reason: "errors" };
}

export function minimalReferencesState(options: {
  citations: readonly Citation[];
  errors: readonly DocumentCitationError[];
  formattingFailed: boolean;
}): Pick<ReferencesState, "entries" | "listMode" | "formattingFailed"> {
  const { citations, errors, formattingFailed } = options;
  return {
    entries: buildReferenceEntries(citations, { errors }),
    listMode: { kind: "minimal" },
    formattingFailed,
  };
}
