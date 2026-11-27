import { Effect } from "effect";

import type {
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";

import { collectionWarnings } from "./collection-warnings.ts";
import { datasetEngine } from "./dataset-engines.ts";
import type { QueryDataset } from "./dataset.ts";
import type { WarningSource } from "./diagnose.ts";
import { diagnoseUnusedFormula, diagnoseWarning } from "./diagnose.ts";
import type { ItemQueryError } from "./error.ts";
import { consumeDataset } from "./execution.ts";
import type { FilterPlan } from "./filter-plan.ts";
import { indexedKeyWarnings } from "./indexed-key-selection.ts";
import { readQueryClock } from "./query-clock.ts";
import type { QuerySources } from "./query-sources.ts";
import { openQuerySources } from "./query-sources.ts";
import type {
  ItemQueryRequest,
  QueryResult,
  QueryRow,
  QueryMetadata,
  QueryGroup,
  TargetLibrary,
} from "./request.ts";
import { planRequest } from "./request.ts";

export interface QuerySummary extends QueryMetadata {
  readonly groups?: readonly Omit<QueryGroup, "rows">[];
  readonly totalCount?: number;
  readonly matchedCount: number;
}

const expressionWarnings = Effect.fnUntraced(function* (
  source: WarningSource,
  expression: FilterPlan,
  {
    dataset,
    libraries,
    sources,
    warning,
  }: {
    dataset: QueryDataset;
    libraries: readonly TargetLibrary[];
    sources: QuerySources;
    warning: Parameters<typeof diagnoseWarning>[2];
  },
) {
  return [
    ...expression.warnings,
    ...(yield* collectionWarnings(expression.root, libraries, sources)),
    ...indexedKeyWarnings(expression.root, dataset.id, libraries),
  ]
    .sort((a, b) => a.at.from - b.at.from)
    .map((fault) => diagnoseWarning(fault, source, warning));
});

export interface QueryConsumer<A, E = never, R = never> {
  write(
    rows: readonly QueryRow[],
    groupIndex?: number,
  ): Effect.Effect<void, E, R>;
  readonly end: Effect.Effect<A, E, R>;
}

export function collectQuery(
  dataset: QueryDataset,
  request: ItemQueryRequest,
): Effect.Effect<
  QueryResult,
  ItemQueryError | ItemQueryLayoutError | ItemQueryDatabaseError,
  ItemQueryDatabase
> {
  return consumeQuery(dataset, request, (summary) =>
    Effect.sync(() => {
      const rows: QueryRow[] = [];
      const {
        groups: summaries,
        totalCount,
        matchedCount: _matched,
        ...metadata
      } = summary;
      const groups = summaries?.map((group) => ({
        ...group,
        rows: [] as QueryRow[],
      }));
      return {
        write: (chunk, groupIndex) =>
          Effect.sync(() => {
            const target =
              groups && groupIndex !== undefined
                ? groups[groupIndex]!.rows
                : rows;
            for (const row of chunk) target.push(row);
          }),
        end: Effect.sync((): QueryResult =>
          groups
            ? { ...metadata, totalCount: totalCount!, groups }
            : { ...metadata, rows },
        ),
      };
    }),
  );
}

export function consumeQuery<A, E, R>(
  dataset: QueryDataset,
  request: ItemQueryRequest,
  begin: (summary: QuerySummary) => Effect.Effect<QueryConsumer<A, E, R>, E, R>,
): Effect.Effect<
  A,
  ItemQueryError | ItemQueryLayoutError | ItemQueryDatabaseError | E,
  ItemQueryDatabase | R
> {
  return Effect.gen(function* () {
    const sources = yield* openQuerySources;
    const plan = yield* planRequest(
      dataset,
      request,
      yield* sources.formulaSourceCheck(request),
    );
    const { query, sorts } = plan;
    const clock = yield* readQueryClock;
    const engine = datasetEngine(dataset);
    const run = yield* engine.open(plan, request, { clock, sources });
    return yield* consumeDataset(
      {
        ...run,
        dataset: engine,
        sources,
        filter: plan.filter?.root,
        query,
        warnings: [
          ...(yield* Effect.forEach(
            [
              ...(plan.filter
                ? [{ source: { text: query.filter! }, plan: plan.filter }]
                : []),
              ...plan.formulas.map((formula) => ({
                source: { text: formula.text, formula: formula.name },
                plan: formula.plan,
              })),
            ],
            (expression) =>
              expressionWarnings(expression.source, expression.plan, {
                dataset,
                libraries: request.libraries,
                sources,
                warning: { clock, dataset, context: query.context },
              }),
          )).flat(),
          ...plan.unusedFormulas.map(diagnoseUnusedFormula),
        ],
        formulaDiagnostics: plan.formulaDiagnostics ?? undefined,
        libraries: request.libraries,
        sort: plan.order,
        readScanPage: engine.readScanPage,
        readUniverseRows: engine.readUniverseRows,
        keys: (item) => sorts.map((sort) => sort.key(item, clock)),
        groupValues: plan.group && plan.group.values,
      },
      begin,
    );
  });
}
