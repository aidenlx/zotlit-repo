import type {
  QueryViewOutcome,
  QueryViewRequest,
} from "#worker/item-query/query-view.ts";
import type { QueryHostDeps } from "./host.ts";

export const fakeQuery = (
  run: QueryHostDeps["query"]["run"],
): QueryHostDeps["query"] => ({
  run,
  on: () => () => {},
  customFieldNames: async () => [],
});

export function requested(
  outcome: QueryViewOutcome,
  request: QueryViewRequest,
): QueryViewOutcome {
  if (outcome.kind !== "result" || !outcome.result.rows) return outcome;
  const fields = new Set(request.fields);
  return {
    ...outcome,
    result: {
      ...outcome.result,
      rows: outcome.result.rows.map((row) => ({
        ...row,
        values: Object.fromEntries(
          Object.entries(row.values).filter(([path]) => fields.has(path)),
        ),
      })),
    },
  };
}
