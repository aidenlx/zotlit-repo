import {
  CancelledError,
  focusManager,
  partialMatchKey,
  QueryClient,
} from "@tanstack/query-core";
import type { Query, QueryFunction, QueryKey } from "@tanstack/query-core";
import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  PubSub,
  Stream,
} from "effect";

import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { instantClock } from "@zotlit/plugin-kernel/worker/effect-clock.ts";

export interface Held<T> {
  readonly value: T;
  readonly status: "fresh" | "revalidating" | "failed";
  readonly settled: Promise<T | null>;
}

export const FAILURE_COOLDOWN_MILLIS = Duration.toMillis(Duration.seconds(5));

type ReadResult<T> =
  | { kind: "value"; value: T }
  | { kind: "failed"; error: unknown; held: T | null; cooldown: boolean }
  | { kind: "cancelled"; held: T | null }
  | { kind: "released" };

export interface HeldReadEvents<T> {
  changed?: (key: QueryKey) => void;
  settled: (key: QueryKey, held: Held<T> | null) => void;
}

export interface HeldReadChange {
  readonly key: QueryKey;
  readonly held: Held<unknown> | null;
  readonly changed: boolean;
}

export class QueryClients extends Context.Service<
  QueryClients,
  {
    readonly client: QueryClient;
    readonly changes: Stream.Stream<HeldReadChange>;
    invalidate(key: QueryKey): Effect.Effect<void>;
    update<T>(key: QueryKey, next: (held: T) => T): Effect.Effect<void>;
    keysUnder(prefix: QueryKey): Effect.Effect<QueryKey[]>;
    peek<T>(key: QueryKey): Effect.Effect<Held<T> | null>;
    ask<T>(key: QueryKey, queryFn: QueryFunction<T>): Effect.Effect<T | null>;
    read<T>(key: QueryKey, queryFn: QueryFunction<T>): Effect.Effect<T | null>;
    readFresh<T>(
      key: QueryKey,
      queryFn: QueryFunction<T>,
    ): Effect.Effect<T, unknown>;
    watch<T>(
      prefix: QueryKey,
      on: HeldReadEvents<T>,
    ): Effect.Effect<() => void>;
  }
>()("zotlit/query-client/QueryClients") {}

const makeQueryClients = Effect.gen(function* () {
  const now = instantClock(yield* Clock.Clock);
  const run = Effect.runSyncWith(yield* Effect.context<never>());
  let closed = false;
  const settlements = yield* PubSub.unbounded<HeldReadChange>();
  const failures = new Map<string, number>();
  const watchers = new Set<() => void>();
  const client = yield* Effect.acquireRelease(
    Effect.sync(() => {
      focusManager.setFocused(true);
      return new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: Infinity,
            retry: false,
            networkMode: "always",
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
          },
        },
      });
    }),
    (client) =>
      Effect.sync(() => {
        closed = true;
        client.clear();
      }),
  );

  const invalidate = Effect.fn("QueryClients.invalidate")(
    (queryKey: QueryKey) =>
      Effect.sync(() => {
        void client.cancelQueries({ queryKey }, { revert: true });
        void client.invalidateQueries({ queryKey, refetchType: "none" });
        for (const query of client.getQueryCache().findAll({ queryKey })) {
          failures.delete(query.queryHash);
          if (query.state.status === "error")
            query.setState({ errorUpdatedAt: 0 });
        }
      }),
  );

  const update = Effect.fn("QueryClients.update")(
    <T>(key: QueryKey, next: (held: T) => T) =>
      Effect.sync(() => {
        const query = client
          .getQueryCache()
          .find<T>({ queryKey: key, exact: true });
        if (query === undefined || query.state.data === undefined) return;
        client.setQueryData<T>(key, next(query.state.data));
      }),
  );

  const keysUnder = Effect.fn("QueryClients.keysUnder")((prefix: QueryKey) =>
    Effect.sync(() => {
      return client
        .getQueryCache()
        .findAll({ queryKey: prefix })
        .map((query) => query.queryKey);
    }),
  );

  function peekValue<T>(key: QueryKey): Held<T> | null {
    const query = client
      .getQueryCache()
      .find<T>({ queryKey: key, exact: true });
    if (query === undefined || query.state.data === undefined) return null;
    const { data, status, fetchStatus } = query.state;
    return {
      value: data,
      status:
        fetchStatus === "fetching"
          ? "revalidating"
          : status === "error"
            ? "failed"
            : "fresh",
      settled: settledValue(query),
    };
  }

  const ask = Effect.fn("QueryClients.ask")(function* <T>(
    key: QueryKey,
    queryFn: QueryFunction<T>,
  ): Effect.fn.Return<T | null> {
    const result = yield* settle(key, queryFn);
    if (result.kind === "value") return result.value;
    return result.kind === "failed" && result.cooldown ? result.held : null;
  });

  const read = Effect.fn("QueryClients.read")(function* <T>(
    key: QueryKey,
    queryFn: QueryFunction<T>,
  ): Effect.fn.Return<T | null> {
    const result = yield* settle(key, queryFn);
    if (result.kind === "value") return result.value;
    return result.kind === "released" ? null : result.held;
  });

  const readFresh = Effect.fn("QueryClients.readFresh")(function* <T>(
    key: QueryKey,
    queryFn: QueryFunction<T>,
  ): Effect.fn.Return<T, unknown> {
    const result = yield* settle(key, queryFn);
    if (result.kind === "value") return result.value;
    if (result.kind === "failed") return yield* Effect.fail(result.error);
    return yield* Effect.fail(
      new DOMException(`Held read ${result.kind}`, "AbortError"),
    );
  });

  const watch = Effect.fn("QueryClients.watch")(
    <T>(prefix: QueryKey, on: HeldReadEvents<T>) =>
      Effect.sync(() => {
        if (closed) return () => {};
        const holding = new Map<string, unknown>();
        const unsubscribe = client.getQueryCache().subscribe((event) => {
          if (!partialMatchKey(event.query.queryKey, prefix)) return;
          const { queryHash, queryKey } = event.query;
          if (event.type === "removed") {
            holding.delete(queryHash);
            return;
          }
          if (event.type !== "updated") return;
          switch (event.action.type) {
            case "fetch":
              holding.set(queryHash, event.query.state.data);
              return;
            case "success": {
              const held = holding.get(queryHash);
              holding.delete(queryHash);
              if (held !== event.query.state.data) on.changed?.(queryKey);
              on.settled(queryKey, peekValue<T>(queryKey));
              return;
            }
            case "error":
              holding.delete(queryHash);
              on.settled(queryKey, peekValue<T>(queryKey));
              return;
            default:
              return;
          }
        });
        const stop = () => {
          unsubscribe();
          watchers.delete(stop);
        };
        watchers.add(stop);
        return stop;
      }),
  );

  const settle = Effect.fn("QueryClients.settle")(function* <T>(
    key: QueryKey,
    queryFn: QueryFunction<T>,
  ): Effect.fn.Return<ReadResult<T>> {
    if (closed) return { kind: "released" };
    const reading = fetch(key, queryFn);
    const cache = client.getQueryCache();
    const query = cache.find({ queryKey: key, exact: true });
    const released = () =>
      closed || cache.find({ queryKey: key, exact: true }) !== query;
    const joined = yield* Effect.promise(() => reading);
    if (released()) return { kind: "released" };
    if (joined.kind !== "cancelled") return joined;
    yield* Effect.logDebug("Held read cancelled, asking again").pipe(
      Effect.annotateLogs({ queryKey: key }),
    );
    const retried = yield* Effect.promise(() => fetch(key, queryFn));
    return released() ? { kind: "released" } : retried;
  }, withLogCategory("query-client"));

  function fetch<T>(
    key: QueryKey,
    queryFn: QueryFunction<T>,
  ): Promise<ReadResult<T>> {
    const query = client
      .getQueryCache()
      .find<T>({ queryKey: key, exact: true });
    const state = query?.state;
    const failedAt = query && failures.get(query.queryHash);
    if (
      state?.status === "error" &&
      failedAt !== undefined &&
      now().epochMilliseconds - failedAt < FAILURE_COOLDOWN_MILLIS
    ) {
      run(
        Effect.logTrace("Failed held read served without a fresh one").pipe(
          Effect.annotateLogs({
            queryKey: key,
            held: state.data !== undefined,
          }),
          withLogCategory("query-client"),
        ),
      );
      return Promise.resolve({
        kind: "failed",
        error: state.error,
        held: state.data ?? null,
        cooldown: true,
      });
    }
    return client.fetchQuery<T>({ queryKey: key, queryFn }).then(
      () => {
        const settled = client.getQueryState<T>(key);
        if (settled === undefined) return { kind: "released" };
        return settled.isInvalidated
          ? { kind: "cancelled", held: settled.data ?? null }
          : { kind: "value", value: settled.data! };
      },
      (error: unknown) => {
        const held = client.getQueryData<T>(key) ?? null;
        if (!(error instanceof CancelledError))
          return { kind: "failed", error, held, cooldown: false };
        if (error.silent !== true) return { kind: "cancelled", held };
        run(
          Effect.logDebug("Held read released before it settled").pipe(
            Effect.annotateLogs({ queryKey: key }),
            withLogCategory("query-client"),
          ),
        );
        return { kind: "released" };
      },
    );
  }
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      client.getQueryCache().subscribe((event) => {
        if (event.type === "removed") failures.delete(event.query.queryHash);
        if (event.type !== "updated") return;
        if (event.action.type === "error")
          failures.set(event.query.queryHash, now().epochMilliseconds);
        if (event.action.type === "success")
          failures.delete(event.query.queryHash);
      }),
    ),
    (unsubscribe) => Effect.sync(unsubscribe),
  );
  let changed = false;
  const stopChanges = yield* watch([], {
    changed: () => {
      changed = true;
    },
    settled: (key, held) => {
      const next = { key, held, changed };
      changed = false;
      run(PubSub.publish(settlements, next));
    },
  });
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      closed = true;
      stopChanges();
      for (const stop of watchers) stop();
      failures.clear();
      yield* PubSub.shutdown(settlements);
    }),
  );

  const peek = Effect.fn("QueryClients.peek")(<T>(key: QueryKey) =>
    Effect.sync(() => {
      return peekValue<T>(key);
    }),
  );
  return QueryClients.of({
    client,
    changes: Stream.fromPubSub(settlements),
    invalidate,
    update,
    keysUnder,
    ask,
    read,
    readFresh,
    watch,
    peek,
  });
});

export const layerQueryClients = Layer.effect(QueryClients, makeQueryClients);

function settledValue<T>(query: Query<T>): Promise<T | null> {
  const reading = query.promise;
  if (reading !== undefined)
    return reading.then(
      (value) => value,
      () => null,
    );
  return Promise.resolve(
    query.state.status === "error" ? null : (query.state.data ?? null),
  );
}
