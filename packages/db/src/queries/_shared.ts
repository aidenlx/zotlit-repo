import type { ZoteroDatabase } from "#client/database.ts";
import type { relations } from "#drizzle/relations.ts";
import type { AnyColumn, DBQueryConfig, Placeholder, SQL } from "drizzle-orm";
import { inArray, sql } from "drizzle-orm";

export { CHILD_ITEM_TYPES } from "#lib/item-types.ts";

export type FindManyOptions<TName extends keyof typeof relations> =
  DBQueryConfig<"many", typeof relations, (typeof relations)[TName]>;

type Prepared<T> = T extends { prepare(): infer P } ? P : never;

type ParamMethods = "run" | "all" | "get" | "values" | "execute";

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

export type ParamsPlaceholder<TParams> = <
  K extends Extract<keyof TParams, string>,
>(
  name: K,
) => Placeholder<K, TParams[K]>;

export interface QueryOperators<TParams> {
  placeholder: ParamsPlaceholder<TParams>;
}

type CacheValue =
  | string
  | number
  | boolean
  | null
  | readonly (string | number | boolean | null)[];

type CacheArgs = Readonly<Record<string, CacheValue>>;

type ArgsRest<T extends CacheArgs> = [Record<string, never>] extends [T]
  ? [args?: T]
  : [args: T];

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

function cacheKey(args: CacheArgs | undefined): string {
  if (!args) return "";
  const keys = Object.keys(args).sort();
  if (keys.length === 0) return "";
  const sorted: Record<string, CacheValue> = {};
  for (const k of keys) sorted[k] = args[k]!;
  return JSON.stringify(sorted);
}

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
