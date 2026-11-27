import type { CitationOutcome } from "./outcome.ts";
import type { CitationOccurrence } from "./scan.ts";
import { occurrencesEqual } from "./scan.ts";

export interface ResolvedNote {
  indexedKey: string;
  linkpath: string | null;
}

export type ResolveOccurrence = (
  occurrence: CitationOccurrence,
) => ResolvedNote | null;

export interface Citation {
  outcome?: CitationOutcome;
  indexedKey: string | null;
  linkpath: string | null;
  refNumber: number;
  occurrences: CitationOccurrence[];
}

export function groupCitations(
  occurrences: readonly CitationOccurrence[],
  resolve: ResolveOccurrence,
): Citation[] {
  const byIdentity = new Map<string, Citation>();

  for (const occurrence of occurrences) {
    const note = resolve(occurrence);
    if (!note && occurrence.kind === "wikilink") continue;
    const identity = note
      ? `key:${note.indexedKey}`
      : `${occurrence.kind}:${occurrence.raw}`;

    const existing = byIdentity.get(identity);
    if (existing) {
      existing.occurrences.push(occurrence);
      continue;
    }
    byIdentity.set(identity, {
      indexedKey: note?.indexedKey ?? null,
      linkpath: note?.linkpath ?? null,
      refNumber: byIdentity.size + 1,
      occurrences: [occurrence],
    });
  }

  return [...byIdentity.values()];
}

export function citationsEqual(
  prev: readonly Citation[],
  next: readonly Citation[],
): boolean {
  if (prev.length !== next.length) return false;
  return prev.every((citation, index) => {
    const other = next[index]!;
    return (
      citation.indexedKey === other.indexedKey &&
      JSON.stringify(citation.outcome) === JSON.stringify(other.outcome) &&
      citation.linkpath === other.linkpath &&
      citation.refNumber === other.refNumber &&
      occurrencesEqual(citation.occurrences, other.occurrences)
    );
  });
}
