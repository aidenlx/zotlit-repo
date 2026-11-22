import type {
  AnnotationOccurrence,
  AnnotationUse,
  CitationCoverage,
  CitationKeyResolution,
  CitationOccurrence,
  CitationSyntax,
  CitationSyntaxes,
  CitedByGroup,
  DatabaseReadability,
} from "#obsidian/citation-index/service.ts";
import type { Loc } from "obsidian";

import {
  INVALID_ARGUMENT_HINT,
  createCliDiagnostics,
} from "@zotlit/obsidian-kit/cli-diagnostic.ts";
import type { SnapshotItem } from "@zotlit/zotero-reads/contract/citation-lookup.ts";

export const CONTRACT_VERSION = 4;

export interface CitationsIdentity {
  vault: {
    name: string;
    path: string;
  };
  source: {
    id: string | null;
    databasePath: string;
  };
}

export const DIAGNOSTIC_HINTS = {
  INVALID_SELECTOR: INVALID_ARGUMENT_HINT,
  TARGET_MISMATCH:
    "Confirm the intended Zotero source with the user before you query citations again.",
  INDEX_NOT_READY:
    "Run the command again after a short wait; the Citation Index is still scanning the vault or resolving citation keys.",
  KEY_NOT_FOUND:
    "Select a Zotero key or a citation key that names an item in the connected Zotero source.",
  AMBIGUOUS_CITEKEY:
    "Run the command again with key=<zotero-key>, taken from the candidates in details.",
  FILE_NOT_FOUND:
    "Pass file= the vault-relative path of a Markdown note, as file=folder/note.md.",
} as const satisfies Record<string, string>;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_HINTS;

export interface Diagnostic {
  code: DiagnosticCode;
  message: string;
  hint: string;
  details?:
    | { parameter: string }
    | { target: "source"; expected: string; actual: string | null }
    | { key: string }
    | { citekey: string }
    | { citekey: string; candidates: readonly AmbiguousCandidateKey[] }
    | { file: string };
}

export interface AmbiguousCandidateKey {
  key: string;
  libraryID: number;
}

export function reportCandidates(
  candidates: readonly SnapshotItem[],
): AmbiguousCandidateKey[] {
  return candidates.map(({ indexedKey, libraryID }) => ({
    key: indexedKey,
    libraryID,
  }));
}

export const { diagnostic, rejectionDiagnostic } = createCliDiagnostics<
  typeof DIAGNOSTIC_HINTS,
  Diagnostic["details"]
>(DIAGNOSTIC_HINTS, "INVALID_SELECTOR");

export type CitationsCommand =
  | "zotlit:annotation-uses"
  | "zotlit:cited-by"
  | "zotlit:references"
  | "zotlit:citations-guide";

export interface CitedItem {
  key: string;
  citekey: string | null;
  summary: string | null;
}

interface ReportedLoc {
  line: number;
  col: number;
  offset: number;
}

export interface ReportedOccurrence {
  kind: CitationSyntax;
  raw: string;
  pageLabel?: string | null;
  position: { start: ReportedLoc; end: ReportedLoc };
}

interface ReportedGroup {
  path: string;
  occurrences: readonly ReportedOccurrence[];
}

export function reportOccurrences(
  occurrences: readonly CitationOccurrence[],
): ReportedOccurrence[] {
  return occurrences.map(({ kind, raw, position, pageLabel }) => ({
    kind,
    raw,
    ...(pageLabel === undefined ? {} : { pageLabel }),
    position: {
      start: reportLoc(position.start),
      end: reportLoc(position.end),
    },
  }));
}

export function reportGroups(groups: readonly CitedByGroup[]): ReportedGroup[] {
  return groups.map(({ path, occurrences }) => ({
    path,
    occurrences: reportOccurrences(occurrences),
  }));
}

function reportLoc({ line, col, offset }: Loc): ReportedLoc {
  return { line: line + 1, col: col + 1, offset };
}

interface ReportedAnnotationOccurrence {
  form: AnnotationOccurrence["form"];
  text: string;
  position: { start: ReportedLoc; end: ReportedLoc };
}

interface AnnotationUsesPayload {
  groups: { path: string; occurrences: ReportedAnnotationOccurrence[] }[];
  coverage: CitationCoverage;
}

export function reportAnnotationUses(
  uses: readonly AnnotationUse[],
): AnnotationUsesPayload["groups"] {
  const groups = new Map<string, ReportedAnnotationOccurrence[]>();
  for (const {
    path,
    occurrence: { form, text, position },
  } of uses) {
    const occurrences = groups.get(path) ?? [];
    occurrences.push({
      form,
      text,
      position: {
        start: reportLoc(position.start),
        end: reportLoc(position.end),
      },
    });
    groups.set(path, occurrences);
  }
  return [...groups].map(([path, occurrences]) => ({ path, occurrences }));
}

interface CitedByPayload {
  item: CitedItem;
  groups: readonly ReportedGroup[];
  omittedSyntaxes: readonly CitationSyntax[];
  coverage: CitationCoverage;
  resolution: CitationKeyResolution;
  syntaxes: CitationSyntaxes;
}

export type ReferenceEntry = { occurrences: readonly ReportedOccurrence[] } & (
  | {
      refNumber: number;
      kind: "resolved";
      key: string;
      citekey: string | null;
      summary: string | null;
      linkpath: string | null;
    }
  | { refNumber: number; kind: "unresolved"; citekey: string }
  | { refNumber: number; kind: "unresolved"; annotationKey: string }
  | {
      refNumber: number;
      kind: "ambiguous";
      citekey: string;
      candidates: readonly AmbiguousCandidateKey[];
    }
  | { refNumber: number; kind: "missing"; key: string }
  | { refNumber: number; kind: "unreadable" }
  | { kind: "malformed" }
);

interface ReferencesPayload {
  coverage: CitationCoverage;
  entries: readonly ReferenceEntry[];
  omittedSyntaxes: readonly CitationSyntax[];
  database: DatabaseReadability;
  resolution: CitationKeyResolution;
  syntaxes: CitationSyntaxes;
}

interface EnvelopeFacts {
  request?: object;
  identity?: CitationsIdentity;
}

export type EnvelopeTail =
  | (EnvelopeFacts & { ok: false; diagnostic: Diagnostic })
  | (EnvelopeFacts & { ok: true } & (
        | CitedByPayload
        | ReferencesPayload
        | AnnotationUsesPayload
      ));

export function envelope(
  command: CitationsCommand,
  tail: EnvelopeTail,
): string {
  return JSON.stringify(
    { contractVersion: CONTRACT_VERSION, command, ...tail },
    null,
    2,
  );
}

export function notSettledDiagnostic(timeoutMs: number): Diagnostic {
  return diagnostic(
    "INDEX_NOT_READY",
    `The Citation Index did not settle within ${timeoutMs} ms.`,
  );
}

export function keyNotFoundDiagnostic(key: string): Diagnostic {
  return diagnostic("KEY_NOT_FOUND", `No Zotero item matches '${key}'.`, {
    key,
  });
}

export function citekeyNotFoundDiagnostic(citekey: string): Diagnostic {
  return diagnostic(
    "KEY_NOT_FOUND",
    `No Zotero item carries the citation key '${citekey}'.`,
    { citekey },
  );
}

export function ambiguousCitekeyDiagnostic(
  citekey: string,
  candidates: readonly AmbiguousCandidateKey[],
): Diagnostic {
  return diagnostic(
    "AMBIGUOUS_CITEKEY",
    `${candidates.length} Zotero items carry the citation key '${citekey}' in the current library scope.`,
    { citekey, candidates },
  );
}

export function fileNotFoundDiagnostic(file: string): Diagnostic {
  return diagnostic(
    "FILE_NOT_FOUND",
    `The vault holds no Markdown note at '${file}'.`,
    { file },
  );
}
