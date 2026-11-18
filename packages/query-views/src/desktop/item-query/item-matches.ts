// The one Items query of ZotLit Query that tests Profile Matches: the request
// for many Items and many filters, and what its outcome says of each Item.
// The layer fills the notes feature's Item Match port with it.
import { Effect, Layer } from "effect";

import { ItemMatchQuery } from "@zotlit/notes/core/profile-selection/item-matches.ts";
import type {
  BatchMatches,
  MatchItem,
} from "@zotlit/notes/core/profile-selection/item-matches.ts";
import { formatIndexedKey } from "@zotlit/zotero-types/keys";

import type { Diagnostic } from "./contract.ts";
import type { QueryViewOutcome, QueryViewRequest } from "./query-view.ts";
import { QueryService } from "./service.ts";

/**
 * The Items query that tests each of `items` against each of `filters`, over
 * the Libraries the Items belong to.
 */
function matchesRequest(
  items: readonly MatchItem[],
  filters: readonly string[],
): QueryViewRequest {
  // `!!` gives the truth a filter reads: null and an Error Value are false.
  const formulas = Object.fromEntries(
    filters.map((filter, index) => [`match${index}`, `!!(${filter})`]),
  );
  const indexedKeys = items.map(({ key, groupID }) =>
    formatIndexedKey(key, groupID),
  );
  return {
    from: "items",
    // A literal list of Indexed Keys plans as a key lookup, not a scan.
    filter: `${JSON.stringify(indexedKeys)}.contains(indexedKey)`,
    fields: Object.keys(formulas).map((name) => `formula.${name}`),
    formulas,
    libraries: {
      mode: "selected",
      libraries: [...new Set(items.map(({ groupID }) => groupID))].map(
        (groupID) =>
          groupID === null
            ? { type: "personal" as const }
            : { type: "group" as const, groupID },
      ),
    },
  };
}

/**
 * What the outcome of {@link matchesRequest} says of each Item: whether each
 * filter holds and the Diagnostic of each filter that cannot be evaluated, or
 * the failure, with its Diagnostic where it gives one.
 */
function readMatches(
  outcome: QueryViewOutcome,
  filters: readonly string[],
): BatchMatches {
  if (outcome.kind === "cancelled") return { kind: "failed" };
  if (outcome.kind === "failed")
    return { kind: "failed", diagnostic: outcome.diagnostic };
  const faultsByName: Readonly<Record<string, Diagnostic | undefined>> =
    outcome.result.formulaDiagnostics ?? {};
  const faults = filters.map((_, index) => faultsByName[`match${index}`]);
  return {
    kind: "result",
    byKey: new Map(
      (outcome.result.rows ?? []).map((row) => [
        row.indexedKey,
        {
          matched: filters.map(
            (_, index) => row.values[`formula.match${index}`] === true,
          ),
          faults,
        },
      ]),
    ),
  };
}

/** The Item Match port over this vault's ZotLit Query service. */
export const layerItemMatchQuery = Layer.effect(
  ItemMatchQuery,
  Effect.gen(function* () {
    const query = yield* QueryService;
    return ItemMatchQuery.of({
      matches: (items, filters) =>
        Effect.map(query.run(matchesRequest(items, filters)), (outcome) =>
          readMatches(outcome, filters),
        ),
      customFieldNames: query.customFieldNames,
    });
  }),
);
