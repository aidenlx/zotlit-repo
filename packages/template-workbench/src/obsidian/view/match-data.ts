import type {
  WorkbenchHost,
  WorkbenchLibrary,
  WorkbenchMatchResult,
} from "#obsidian/workbench-ui/index.tsx";
// Match vocabulary spans every Library in the pinned live database.
import { Effect } from "effect";

import { planItemFilter, testItemSeed } from "@zotlit/item-query";
import { ItemMatchQuery } from "@zotlit/notes/core/profile-selection/item-matches.ts";
import { readerText } from "@zotlit/obsidian-kit/reader-diagnostic.ts";
import type { ReaderDiagnosticSource } from "@zotlit/obsidian-kit/reader-diagnostic.ts";
import type { ViewRunner } from "@zotlit/obsidian-kit/view-runner.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import {
  resolveLibraryScope,
  selectorKey,
} from "@zotlit/zotero-reads/contract/library-scope.ts";
import { formatIndexedKey, parseIndexedKey } from "@zotlit/zotero-types/keys";

import { getSampleItem } from "#core/editor/selection-data.ts";
import { hostEffect } from "#obsidian/editor/host.tsx";

/**
 * The Match vocabulary and test, each forked on the runner of the mount that
 * reads it: its interrupt stops the read under it. The Workbench shows the
 * Match pane twice, and each copy reads at once.
 */
export function createMatchData(
  provide: ViewRunner["provide"],
): WorkbenchHost["matchData"] {
  return {
    tags: hostEffect(
      provide(
        Effect.scoped(
          Effect.gen(function* () {
            const reads = yield* (yield* ZoteroReads).snapshot;
            return [...(yield* reads.TagNames({}))];
          }),
        ),
      ),
    ),
    collections: hostEffect(
      provide(
        Effect.scoped(
          Effect.gen(function* () {
            const reads = yield* (yield* ZoteroReads).snapshot;
            const libraries = resolveLibraryScope(yield* reads.Libraries({}), {
              mode: "all",
            }).available;
            const paths = yield* reads.CollectionPaths({
              libraryIDs: libraries.map(({ libraryID }) => libraryID),
            });
            return paths.map((path) => [...path]);
          }),
        ),
      ),
    ),
    libraries: hostEffect(
      provide(
        Effect.scoped(
          Effect.gen(function* () {
            const reads = yield* (yield* ZoteroReads).snapshot;
            return resolveLibraryScope(yield* reads.Libraries({}), {
              mode: "all",
            }).available.map((library) => ({
              id: selectorKey(library.selector) as WorkbenchLibrary["id"],
              ...(library.name === null ? {} : { name: library.name }),
            }));
          }),
        ),
      ),
    ),
    matches: (indexedKey, filter) =>
      hostEffect(provide(testMatch(indexedKey, filter))),
    customFields: hostEffect(
      provide(
        Effect.gen(function* () {
          return yield* (yield* ItemMatchQuery).customFieldNames;
        }),
      ),
    ),
  };
}

/**
 * Whether the Item matches `filter`, as Profile selection tests it: a sample
 * Item in memory, from its seed, and a real Item through ZotLit Query.
 */
const testMatch = Effect.fn("TemplateWorkbench.testMatch")(function* (
  indexedKey: string,
  filter: string,
): Effect.fn.Return<WorkbenchMatchResult, unknown, ItemMatchQuery> {
  const planned = planItemFilter(filter);
  if (!("matches" in planned)) return problem(planned);
  const sample = getSampleItem(indexedKey);
  if (sample) {
    if (!sample.seed) return { kind: "missing" };
    const answer = testItemSeed(filter, sample.seed);
    return answer.kind === "problem" ? problem(answer.diagnostic) : answer;
  }
  const parsed = parseIndexedKey(indexedKey);
  if (!parsed) return { kind: "missing" };
  const answer = yield* (yield* ItemMatchQuery).matches([parsed], [filter]);
  if (answer.kind === "failed")
    return answer.diagnostic ? problem(answer.diagnostic) : { kind: "missing" };
  const row = answer.byKey.get(formatIndexedKey(parsed.key, parsed.groupID));
  if (!row) return { kind: "missing" };
  const fault = row.faults[0];
  return fault
    ? problem(fault)
    : { kind: "result", matched: row.matched[0] === true };
});

/** A Diagnostic as the Match tab shows it, on its condition where it has one. */
function problem(
  diagnostic: ReaderDiagnosticSource & {
    location?: { span?: { from: number; to: number } };
  },
): WorkbenchMatchResult {
  return {
    kind: "problem",
    message: readerText(diagnostic),
    ...(diagnostic.location?.span ? { span: diagnostic.location.span } : {}),
  };
}
