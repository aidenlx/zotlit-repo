import type { ZoteroDatabase } from "#client/database.ts";
import type { relations } from "#drizzle/relations.ts";
import { inArray, sql } from "drizzle-orm";
import type { AnyColumn, DBQueryConfig, Placeholder, SQL } from "drizzle-orm";

export { CHILD_ITEM_TYPES, type ChildItemType } from "#lib/item-types.ts";

/**
 * Schema-aware shape of an RQB v2 `findMany` config bound to a specific
 * table in our {@link relations} graph. Pair with `satisfies` so per-key
 * narrow literals (e.g. `orderBy: { x: "asc" }`) survive when the object
 * is later spread into a `findMany` call site.
 *
 * @see DBQueryConfig in drizzle-orm/src/relations.ts
 */
export type FindManyOptions<TName extends keyof typeof relations> =
  DBQueryConfig<"many", typeof relations, (typeof relations)[TName]>;

type Prepared<T> = T extends { prepare(): infer P } ? P : never;

/**
 * Methods on Drizzle's `SQLitePreparedQuery` that accept the
 * `placeholderValues?: Record<string, unknown>` argument. Re-typed by
 * {@link WithParams} so call sites get strict checking against the query's
 * declared placeholder shape.
 */
type ParamMethods = "run" | "all" | "get" | "values" | "execute";

/**
 * Re-type the placeholder-accepting methods of a Drizzle prepared statement
 * against the query's declared param shape.
 *
 * - `TParams = void` — methods take no args (query has no placeholders).
 * - `TParams = Record<string, unknown>` (the default) — params optional,
 *   matching Drizzle's native loose typing.
 * - Concrete object type (e.g. `{ libraryID: number }`) — params required and
 *   structurally checked at the call site.
 *
 * Non-param methods (`getQuery`, `mapAllResult`, etc.) pass through unchanged.
 */
type WithParams<TPrep, TParams> = Omit<TPrep, ParamMethods> & {
  [K in ParamMethods & keyof TPrep]: TPrep[K] extends (
    pv?: Record<string, unknown>,
    ...rest: infer R
  ) => infer Ret
    ? [TParams] extends [void]
      ? (...rest: R) => Ret
      : [Record<string, unknown>] extends [TParams]
        ? (params?: TParams, ...rest: R) => Ret
        : (params: TParams, ...rest: R) => Ret
    : TPrep[K];
};

/**
 * Typed wrapper for {@link sql.placeholder}. Each query gets a `placeholder`
 * bound to its declared `TParams`, so referencing an unknown placeholder name
 * is a compile error — `placeholder("libraryId")` fails when
 * `TParams = { libraryID: ... }`.
 */
export type ParamsPlaceholder<TParams> = <
  K extends Extract<keyof TParams, string>,
>(
  name: K,
) => Placeholder<K, TParams[K]>;

/**
 * Operators object passed as the second argument to a {@link defineQuery}
 * builder callback. Bundles typed helpers — currently just `placeholder` — so
 * the signature mirrors Drizzle's own RQB operator-bag pattern.
 */
export interface QueryOperators<TParams> {
  placeholder: ParamsPlaceholder<TParams>;
}

/**
 * Values allowed in a builder's cache-key record — primitives and flat
 * readonly arrays of primitives. Anything {@link JSON.stringify} handles
 * deterministically without depth. `undefined` is intentionally excluded so
 * `{ a: undefined }` can't collide with `{ b: undefined }` at the cache key
 * (both would stringify to `{}`). Use the property's `?:` modifier on the
 * args type to express optionality, and omit the key when unset.
 */
type CacheValue =
  | string
  | number
  | boolean
  | null
  | readonly (string | number | boolean | null)[];

/**
 * Single-arg shape passed to a {@link defineQuery} builder. The same record
 * doubles as the prepared-statement cache key — see {@link cacheKey}.
 */
type CacheArgs = Readonly<Record<string, CacheValue>>;

/**
 * Conditional rest-tuple for the builder-args slot.
 *
 * - `T = Record<string, never>` or all-optional fields → `[args?: T]`.
 * - `T` has any required field → `[args: T]`, so `.prepared(db)` is a
 *   compile error for argful queries.
 *
 * `[Record<string, never>] extends [T]` (tuple-wrapped to disable
 * distribution) is true iff `T` is satisfied by an empty object — i.e. has
 * no required properties.
 */
type ArgsRest<T extends CacheArgs> = [Record<string, never>] extends [T]
  ? [args?: T]
  : [args: T];

/**
 * Callable produced by {@link defineQuery}.
 *
 * - Bare call returns the Drizzle builder (escape hatch for inspection /
 *   `.toSQL()`; not cached, no TParams typing on `.all`).
 * - `.prepared(db, args)` returns a cached prepared statement, re-typed via
 *   {@link WithParams} so `.all` / `.get` / `.run` / `.values` / `.execute`
 *   check against `TParams`.
 *
 * {@link QueryRow} recovers the row shape from the builder type that the
 * interface carries.
 */
export interface DefinedQuery<
  TParams,
  TBuildArgs extends CacheArgs,
  TSyncResult,
> {
  (db: ZoteroDatabase, ...rest: ArgsRest<TBuildArgs>): TSyncResult;
  prepared(
    db: ZoteroDatabase,
    ...rest: ArgsRest<TBuildArgs>
  ): WithParams<Prepared<TSyncResult>, TParams>;
}

/**
 * Stable cache key for a builder-args record. Keys are sorted so callers can
 * pass the same logical args in any order and hit the same prepared statement.
 * Returns `""` for undefined / empty input.
 */
function cacheKey(args: CacheArgs | undefined): string {
  if (!args) return "";
  const keys = Object.keys(args).sort();
  if (keys.length === 0) return "";
  const sorted: Record<string, CacheValue> = {};
  for (const k of keys) sorted[k] = args[k]!;
  return JSON.stringify(sorted);
}

/**
 * Wrap a query, producing a callable that returns its Drizzle builder with a
 * per-client prepared-statement cache.
 *
 * Two-step generic: outer `<TParams>` declares placeholder shape; inner call
 * infers builder arg / result types. Use `<void>` for queries with no
 * placeholders; omit the generic for the default loose
 * `Record<string, unknown>` typing.
 *
 * @example
 *   const q = defineQuery<{ libraryID: number }>()((db, { placeholder }) =>
 *     db.select(...).where(eq(t.libraryID, placeholder("libraryID"))),
 *   );
 *   q.prepared(db).all({ libraryID: 1 }); // typed; missing/extra keys error
 */
export function defineQuery<TParams = Record<string, unknown>>(): <
  TBuildArgs extends CacheArgs = Record<string, never>,
  TSyncResult = unknown,
>(
  refImpl: (
    db: ZoteroDatabase,
    operators: QueryOperators<TParams>,
    args: TBuildArgs,
  ) => TSyncResult,
) => DefinedQuery<TParams, TBuildArgs, TSyncResult> {
  const operators: QueryOperators<TParams> = {
    placeholder: ((name: string) =>
      sql.placeholder(name)) as ParamsPlaceholder<TParams>,
  };

  return <TBuildArgs extends CacheArgs, TSyncResult>(
    refImpl: (
      db: ZoteroDatabase,
      operators: QueryOperators<TParams>,
      args: TBuildArgs,
    ) => TSyncResult,
  ): DefinedQuery<TParams, TBuildArgs, TSyncResult> => {
    const cache = new WeakMap<ZoteroDatabase, Map<string, unknown>>();

    const normalizeArgs = (args: TBuildArgs | undefined): TBuildArgs =>
      (args ?? {}) as TBuildArgs;

    const build = (
      db: ZoteroDatabase,
      args: TBuildArgs | undefined,
    ): TSyncResult => refImpl(db, operators, normalizeArgs(args));

    const call = (db: ZoteroDatabase, args?: TBuildArgs) => build(db, args);

    const prepared = (db: ZoteroDatabase, args?: TBuildArgs) => {
      let perDb = cache.get(db);
      if (!perDb) {
        perDb = new Map();
        cache.set(db, perDb);
      }
      const key = cacheKey(args);
      const hit = perDb.get(key);
      if (hit) return hit;
      const stmt = (build(db, args) as { prepare: () => unknown }).prepare();
      perDb.set(key, stmt);
      return stmt;
    };

    const fn = call as unknown as DefinedQuery<
      TParams,
      TBuildArgs,
      TSyncResult
    >;
    fn.prepared = prepared as DefinedQuery<
      TParams,
      TBuildArgs,
      TSyncResult
    >["prepared"];
    return fn;
  };
}

/**
 * Extract the row type from a {@link defineQuery}-wrapped query. Works for
 * both select chains and relational `findMany` builders by inferring the
 * builder type off {@link DefinedQuery}'s call signature and unwrapping
 * Drizzle's `QueryPromise<TResult>`.
 *
 * @example
 *   export const getTopItems = defineQuery()((db, { placeholder }, args) => ...);
 *   export type TopItem = QueryRow<typeof getTopItems>;
 */
export type QueryRow<Q> =
  Q extends DefinedQuery<any, infer _B, infer R>
    ? Awaited<R> extends ArrayLike<infer E>
      ? E
      : never
    : Q extends (db: ZoteroDatabase, ...args: any[]) => (infer R)[]
      ? R
      : never;

type KeyedOptions<P, A> = ([Record<string, never>] extends [P]
  ? { params?: P }
  : { params: P }) &
  ([Record<string, never>] extends [A] ? { args?: A } : { args: A });

type KeyedOptionsRest<P, A> = [Record<string, never>] extends [
  KeyedOptions<P, A>,
]
  ? [options?: KeyedOptions<P, A>]
  : [options: KeyedOptions<P, A>];

/**
 * A keyed read owns its membership predicate, cached statement, and result
 * ordering. The input keys bind as one JSON array, so list length changes
 * neither the SQL nor its parameter count. Empty input executes no statement.
 * Misses add no rows; duplicates repeat their rows in request order.
 *
 * `contains(column)` belongs in an RQB `RAW` filter and must select the same
 * key that `keyOf` returns. The query describes independent keyed rows; global
 * limits and aggregates belong in a different query.
 */
export function defineKeyedQuery<
  K extends string | number,
  TParams extends Record<string, unknown> = Record<string, never>,
>() {
  return <R, TBuildArgs extends CacheArgs = Record<string, never>>(
    build: (
      db: ZoteroDatabase,
      operators: {
        contains: (column: AnyColumn) => SQL;
        placeholder: ParamsPlaceholder<TParams>;
      },
      args: TBuildArgs,
    ) => { prepare(): { all(params?: Record<string, unknown>): R[] } },
    {
      keyOf,
      orderWithinKey,
    }: {
      keyOf: (row: NoInfer<R>) => K;
      orderWithinKey?: (a: NoInfer<R>, b: NoInfer<R>) => number;
    },
  ): ((
    db: ZoteroDatabase,
    keys: readonly K[],
    ...options: KeyedOptionsRest<TParams, TBuildArgs>
  ) => R[]) => {
    const query = defineQuery()((db, { placeholder }, args: TBuildArgs) =>
      build(
        db,
        {
          contains: (column) =>
            inArray(
              column,
              sql`(select value from json_each(${placeholder("__keys")}))`,
            ),
          placeholder: placeholder as ParamsPlaceholder<TParams>,
        },
        args,
      ),
    );
    return (db, keys, ...[options]) => {
      if (keys.length === 0) return [];
      const rows = query
        .prepared(db, ...([options?.args] as ArgsRest<TBuildArgs>))
        .all({
          ...options?.params,
          __keys: JSON.stringify([...new Set(keys)]),
        });
      const byKey = Map.groupBy(rows, keyOf);
      if (orderWithinKey) {
        for (const group of byKey.values()) group.sort(orderWithinKey);
      }
      return keys.flatMap((key) => byKey.get(key) ?? []);
    };
  };
}
