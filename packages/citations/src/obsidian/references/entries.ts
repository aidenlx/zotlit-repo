import type { Inlines } from "#core/pandoc/ast.ts";
import type { AmbiguousCandidate } from "#obsidian/citation-index/ambiguity.ts";
import type {
  Citation,
  CitationOccurrence,
  DocumentCitationError,
  ReferenceSource,
} from "#obsidian/citation-index/service.ts";

export interface RenderedReference {
  marker: Inlines | undefined;
  content: Inlines;
}

export interface ReferenceBibliography {
  entries: ReadonlyMap<string, RenderedReference>;
  complete: boolean;
}

interface ReferenceEntryBase {
  id: string;
  occurrences: readonly CitationOccurrence[];
}

interface NumberedReferenceEntryBase extends ReferenceEntryBase {
  refNumber: number;
}

type RenderedReferenceEntryBody = {
  kind: "rendered";
  source: ReferenceSource;
  linkpath: string | null;
  serial: number;
} & RenderedReference;

type CitationReferenceEntry = NumberedReferenceEntryBase &
  (
    | RenderedReferenceEntryBody
    | { kind: "summary"; source: ReferenceSource; linkpath: string | null }
    | { kind: "unrendered"; source: ReferenceSource; linkpath: string | null }
    | { kind: "missing"; linkpath: string | null }
    | { kind: "ineligible"; key: string }
    | { kind: "unreadable" }
    | { kind: "unresolved"; citekey: string }
    | { kind: "unresolved"; annotationKey: string }
    | {
        kind: "ambiguous";
        citekey: string;
        candidates: readonly AmbiguousCandidate[];
      }
  );

type MalformedReferenceEntry = ReferenceEntryBase & { kind: "malformed" };

export type ReferenceEntry = CitationReferenceEntry | MalformedReferenceEntry;

export interface ReferenceBuildOptions {
  bibliography?: ReferenceBibliography;
  errors?: readonly DocumentCitationError[];
}

export function buildReferenceEntries(
  citations: readonly Citation[],
  options: ReferenceBuildOptions = {},
): ReferenceEntry[] {
  const { bibliography, errors = [] } = options;
  const placed = new Map<
    string,
    NumberedReferenceEntryBase & Omit<RenderedReferenceEntryBody, "serial">
  >();
  const trailing: ReferenceEntry[] = [];
  for (const citation of citations) {
    const { indexedKey, refNumber, linkpath, occurrences } = citation;
    const outcome = citation.outcome!;
    const base = {
      id:
        indexedKey ??
        `${occurrences[0]!.kind === "annotation" ? "annotation:" : "@"}${occurrences[0]!.raw}`,
      refNumber,
      occurrences,
    };
    switch (outcome.kind) {
      case "unreadable":
        trailing.push({ ...base, kind: "unreadable" });
        continue;
      case "ineligible-item":
        trailing.push({ ...base, kind: "ineligible", key: outcome.key });
        continue;
      case "missing-item":
        trailing.push({ ...base, linkpath, kind: "missing" });
        continue;
      case "missing-annotation":
        trailing.push({
          ...base,
          kind: "unresolved",
          annotationKey: outcome.annotationKey,
        });
        continue;
      case "unresolved-key":
        trailing.push({
          ...base,
          kind: "unresolved",
          citekey: outcome.citekey,
        });
        continue;
      case "ambiguous-key":
        trailing.push({
          ...base,
          kind: "ambiguous",
          citekey: outcome.citekey,
          candidates: outcome.candidates,
        });
        continue;
      case "malformed":
        trailing.push({ ...base, kind: "malformed" });
        continue;
      case "resolved":
        break;
    }
    const source = outcome.source;
    const resolvedBase = { ...base, linkpath };
    const entry = bibliography?.entries.get(source.csl.id);
    if (!entry) {
      trailing.push({
        ...resolvedBase,
        kind: bibliography?.complete ? "unrendered" : "summary",
        source,
      });
      continue;
    }
    placed.set(source.csl.id, {
      ...resolvedBase,
      kind: "rendered",
      source,
      ...entry,
    });
  }

  for (const { occurrence } of errors) {
    trailing.push({
      id: `malformed:${occurrence.position.start.offset}`,
      occurrences: [occurrence],
      kind: "malformed",
    });
  }
  trailing.sort(
    (left, right) =>
      left.occurrences[0]!.position.start.offset -
      right.occurrences[0]!.position.start.offset,
  );

  const ordered: ReferenceEntry[] = [];
  for (const id of bibliography?.entries.keys() ?? []) {
    const entry = placed.get(id);
    if (entry) ordered.push({ ...entry, serial: ordered.length + 1 });
  }
  return [...ordered, ...trailing];
}
