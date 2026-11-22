import type { ZoteroDatabase } from "#client/database.ts";
import type {
  DatabaseLayout,
  LayoutColumnRow,
  LayoutVersionRow,
} from "#layout/index.ts";
import type { QueryOperators } from "#queries/_shared.ts";
import { fillPlaceholders, sql } from "drizzle-orm";
import type { AnyColumn, Query, SQL } from "drizzle-orm";
import { Context, Data, Effect } from "effect";

import { layoutErrorOf } from "./layout.ts";
import type { ItemQueryLayoutError } from "./layout.ts";

import {
  columnsByTable,
  hasVersionStamps,
  knownLayout,
  recordLayout,
  selectLayoutColumns,
  selectLayoutVersions,
} from "#layout/index.ts";
import { defineQuery } from "#queries/_shared.ts";

export class ItemQueryDatabaseError extends Data.TaggedError(
  "ItemQueryDatabaseError",
)<{
  readonly query: string;
  readonly params: readonly unknown[];
  readonly cause: unknown;
}> {
  override get message(): string {
    return `Failed query: ${this.query}\nparams: ${JSON.stringify(this.params, (_, value: unknown) => (typeof value === "bigint" ? String(value) : value))}`;
  }
}

export class ItemQueryDatabase extends Context.Service<
  ItemQueryDatabase,
  { readonly client: ZoteroDatabase }
>()("@zotlit/db/ItemQueryDatabase") {}

export type ItemQueryReaderError =
  | ItemQueryLayoutError
  | ItemQueryDatabaseError;

export type ItemQueryReader =
  | "parent-leaf-candidate-set"
  | "parent-child-candidate-set"
  | "relation-candidate-set"
  | "item-attachments"
  | "item-annotations"
  | "attachment-annotations"
  | "item-notes"
  | "attachment-row-count"
  | "attachment-candidate-set"
  | "attachment-scan-page"
  | "attachment-universe-rows"
  | "attachment-details"
  | "attachment-tags"
  | "annotation-row-count"
  | "annotation-candidate-set"
  | "annotation-scan-page"
  | "annotation-universe-rows"
  | "annotation-details"
  | "annotation-tags"
  | "annotation-attachment-titles"
  | "layout"
  | "libraries"
  | "library-row-count"
  | "scan-page"
  | "candidate-set"
  | "max-item-id"
  | "text-sweep-window"
  | "universe-rows"
  | "field-vocabulary"
  | "collection-paths"
  | "tag-values"
  | "hydrate-chunk";

export interface StatementRun {
  readonly reader: ItemQueryReader;
  readonly params: Readonly<Record<string, unknown>>;
  readonly rows: readonly unknown[];
}

export const ItemQueryStatementObserver = Context.Reference<
  (run: StatementRun) => void
>("@zotlit/db/ItemQueryStatementObserver", { defaultValue: () => () => {} });

export interface Statement<TParams, TRow> {
  all(
    params: TParams,
  ): Effect.Effect<TRow[], ItemQueryReaderError, ItemQueryDatabase>;
}

interface UncheckedStatement<TParams, TRow> {
  all(
    params: TParams,
  ): Effect.Effect<TRow[], ItemQueryDatabaseError, ItemQueryDatabase>;
  readonly sql: (client: ZoteroDatabase) => string;
}

interface Builder<TRow> {
  toSQL(): Query;
  prepare(): { all(params?: Record<string, unknown>): TRow[] };
}

const readerStatements: ((client: ZoteroDatabase) => string)[] = [];

/**
 * @internal The SQL text of every reader statement defined so far. The layout
 * manifest test compiles each one; load the reader modules first.
 */
export function readerStatementSQL(client: ZoteroDatabase): string[] {
  return readerStatements.map((sqlOf) => sqlOf(client));
}

export function unindexed(column: AnyColumn): SQL {
  return sql`+${column}`;
}

export type IdSlot = `id${number}`;

export function idSlots(size: number): {
  readonly names: readonly IdSlot[];
  readonly bind: (itemIDs: readonly number[]) => Record<IdSlot, number | null>;
} {
  const names = Array.from({ length: size }, (_, i) => `id${i}` as const);
  return {
    names,
    bind: (itemIDs) =>
      Object.fromEntries(names.map((slot, i) => [slot, itemIDs[i] ?? null])),
  };
}

type Build<TParams, TRow> = (
  db: ZoteroDatabase,
  operators: QueryOperators<TParams>,
) => Builder<TRow>;

export function defineStatement<TParams extends Record<string, unknown>>(
  reader: ItemQueryReader,
): <TRow>(build: Build<TParams, TRow>) => Statement<TParams, TRow> {
  return <TRow>(build: Build<TParams, TRow>) => {
    const statement = uncheckedStatement<TParams, TRow>(reader, build);
    readerStatements.push(statement.sql);
    return {
      all: (params) => Effect.andThen(checkLayout(), statement.all(params)),
    };
  };
}

function uncheckedStatement<TParams extends Record<string, unknown>, TRow>(
  reader: ItemQueryReader,
  build: Build<TParams, TRow>,
): UncheckedStatement<TParams, TRow> {
  const query = defineQuery<TParams>()(build);
  const failure = (client: ZoteroDatabase, params: TParams, cause: unknown) => {
    const { sql, params: slots } = query(client).toSQL();
    return new ItemQueryDatabaseError({
      query: sql,
      params: fillPlaceholders(slots, params),
      cause,
    });
  };
  return {
    sql: (client) => query(client).toSQL().sql,
    all: (params) =>
      Effect.gen(function* () {
        const { client } = yield* ItemQueryDatabase;
        const observe = yield* ItemQueryStatementObserver;
        return yield* Effect.suspend(() => {
          let rows: TRow[];
          try {
            rows = (
              query.prepared(client) as ReturnType<Builder<TRow>["prepare"]>
            ).all(params);
          } catch (cause) {
            return Effect.fail(failure(client, params, cause));
          }
          observe({ reader, params, rows });
          return Effect.succeed(rows);
        });
      }),
  };
}

const columnsStatement = uncheckedStatement<
  Record<string, never>,
  LayoutColumnRow
>("layout", selectLayoutColumns);

const versionsStatement = uncheckedStatement<
  Record<string, never>,
  LayoutVersionRow
>("layout", selectLayoutVersions);

export function readLayout(): Effect.Effect<
  DatabaseLayout,
  ItemQueryDatabaseError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const { client } = yield* ItemQueryDatabase;
    const known = knownLayout(client);
    if (known) return known;
    const columns = columnsByTable(yield* columnsStatement.all({}));
    const versionRows = hasVersionStamps(columns)
      ? yield* versionsStatement.all({})
      : [];
    return recordLayout(client, columns, versionRows);
  });
}

export function checkLayout(): Effect.Effect<
  DatabaseLayout,
  ItemQueryLayoutError | ItemQueryDatabaseError,
  ItemQueryDatabase
> {
  return Effect.flatMap(readLayout(), (layout) => {
    const error = layoutErrorOf(layout);
    return error ? Effect.fail(error) : Effect.succeed(layout);
  });
}
