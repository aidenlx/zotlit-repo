import { Cause, Effect } from "effect";

import { isChildItemFields } from "@zotlit/db";
import type { Item } from "@zotlit/db";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { itemSummary } from "@zotlit/plugin-kernel/item-summary.ts";
import { libraryLabel } from "@zotlit/plugin-services/core/library-scope/label.ts";
import type { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { SnapshotItem } from "@zotlit/zotero-reads/contract/citation-lookup.ts";
import type {
  AvailableLibrary,
  ResolvedLibraryScope,
} from "@zotlit/zotero-reads/contract/library-scope.ts";

export interface AmbiguousCandidate extends SnapshotItem {
  summary: string;
  library: AvailableLibrary | null;
}

export interface CandidateRow {
  summary: string;
  library: string | null;
  key: string;
}

export function candidateRow(candidate: AmbiguousCandidate): CandidateRow {
  return {
    summary: candidate.summary,
    library: candidate.library ? libraryLabel(candidate.library) : null,
    key: candidate.key,
  };
}

export type AmbiguousCandidatesOf = (
  citekey: string,
) => readonly AmbiguousCandidate[] | null;

export interface CandidateDeps {
  db: Pick<ZoteroReads["Service"], "snapshot">;
  libraryScope: { readonly current: ResolvedLibraryScope | null };
}

export const describeCandidatesEffect = Effect.fnUntraced(function* (
  deps: CandidateDeps,
  candidates: readonly SnapshotItem[],
) {
  const items = yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* deps.db.snapshot;
      return yield* reads.ItemsByIndexedKeys({
        indexedKeys: candidates.map((candidate) => candidate.indexedKey),
      });
    }),
  ).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.logWarning(
            "Ambiguous citekey candidates read without summaries",
            cause,
          ).pipe(
            withLogCategory("citation-index"),
            Effect.as(new Map<string, Item>()),
          ),
    ),
  );
  return describeWith(deps, items, candidates);
});

function describeWith(
  { libraryScope }: CandidateDeps,
  items: ReadonlyMap<string, Item>,
  candidates: readonly SnapshotItem[],
): AmbiguousCandidate[] {
  const libraries = new Map(
    (libraryScope.current?.available ?? []).map((library) => [
      library.libraryID,
      library,
    ]),
  );
  return candidates.map((candidate) => {
    const item = items.get(candidate.indexedKey);
    const fields = item?.fields;
    return {
      ...candidate,
      summary:
        item && fields && !isChildItemFields(fields)
          ? itemSummary(item, fields).formatted
          : candidate.key,
      library: libraries.get(candidate.libraryID) ?? null,
    };
  });
}

export function describeJoinedCandidates(
  candidates: readonly SnapshotItem[],
  sources: ReadonlyMap<string, { summary: string }>,
  libraries: ReadonlyMap<number, AvailableLibrary>,
): AmbiguousCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    summary: sources.get(candidate.indexedKey)?.summary ?? candidate.key,
    library: libraries.get(candidate.libraryID) ?? null,
  }));
}
