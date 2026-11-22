import { Effect, Option, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { homedir } from "node:os";

import { held, viewRuntime } from "@zotlit/obsidian-kit/view-atoms.ts";
import { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsState } from "@zotlit/zotero-reads/client/service.ts";

export type ConnectionReadout =
  | { status: "checking" }
  | { status: "missing" }
  | { status: "connected"; path: string; itemCount: number };

const ITEM_COUNT_KEY = ["welcome", "connection-readout"] as const;

type ConnectionState = Pick<ZoteroReadsState, "state" | "error" | "moved">;

export function unavailable(deps: { reads: ConnectionState }): boolean {
  return (
    deps.reads.state === "degraded" ||
    (deps.reads.error !== null && deps.reads.moved)
  );
}

export function refreshFailed(deps: { reads: ConnectionState }): boolean {
  return !unavailable(deps) && deps.reads.error !== null;
}

const missing = (reads: ConnectionState) =>
  unavailable({ reads }) || refreshFailed({ reads });

const connected = (dataDir: string, itemCount: number): ConnectionReadout => ({
  status: "connected",
  path: dataDir.replace(homedir(), "~"),
  itemCount,
});

export const connectionLifecycleAtom = held(
  Stream.unwrap(
    Effect.gen(function* () {
      const reads = yield* ZoteroReads;
      const queries = yield* QueryClients;
      return reads.events.pipe(
        Stream.filter(
          (event) =>
            event._tag !== "refresh-requested" &&
            (event._tag !== "refreshing" || event.active),
        ),
        Stream.tap((event) =>
          event._tag === "changed"
            ? queries.invalidate(ITEM_COUNT_KEY)
            : Effect.void,
        ),
        Stream.scan(
          () => ({ revision: 0, refreshing: false }),
          (before, event) => ({
            revision: before.revision + 1,
            refreshing: event._tag === "refreshing",
          }),
        ),
      );
    }),
  ),
  { revision: 0, refreshing: false },
);

export const readConnectionSync = Effect.gen(function* () {
  const reads = yield* (yield* ZoteroReads).current;
  if (reads.state === "loading") return null;
  if (missing(reads)) return { status: "missing" } satisfies ConnectionReadout;
  const value = yield* (yield* QueryClients).peek<{ itemCount: number }>(
    ITEM_COUNT_KEY,
  );
  return value === null
    ? null
    : connected(
        (yield* (yield* ZoteroPref).current).dataDir,
        value.value.itemCount,
      );
});

export const readConnectionStatus = Effect.gen(function* () {
  const reads = yield* ZoteroReads;
  if (missing(yield* reads.current))
    return { status: "missing" } satisfies ConnectionReadout;
  const queries = yield* QueryClients;
  const run = Effect.runPromiseWith(yield* Effect.context<never>());
  const value = yield* queries.read(ITEM_COUNT_KEY, ({ signal }) =>
    run(reads.reads.ConnectionReadout({}), { signal }),
  );
  const current = yield* reads.current;
  return value === null || current.state !== "ready" || missing(current)
    ? ({ status: "missing" } satisfies ConnectionReadout)
    : connected((yield* (yield* ZoteroPref).current).dataDir, value.itemCount);
});

export const connectionLoadAtom = viewRuntime.atom((get) => {
  const lifecycle = get(connectionLifecycleAtom);
  const previous = get
    .self<AsyncResult.AsyncResult<ConnectionReadout>>()
    .pipe(Option.flatMap((result) => AsyncResult.value(result)));
  return Stream.unwrap(
    Effect.gen(function* () {
      const seed = yield* readConnectionSync;
      const first =
        seed ??
        Option.getOrElse(previous, (): ConnectionReadout => ({
          status: "checking",
        }));
      const read = lifecycle.refreshing
        ? Effect.never
        : readConnectionStatus.pipe(
            Effect.onInterrupt(() =>
              QueryClients.use((queries) => queries.invalidate(ITEM_COUNT_KEY)),
            ),
          );
      const pending =
        seed === null && first.status !== "checking"
          ? Stream.merge(
              Stream.fromEffect(
                Effect.as(Effect.sleep(200), {
                  status: "checking",
                } as ConnectionReadout),
              ),
              Stream.fromEffect(read),
              { haltStrategy: "right" },
            )
          : Stream.fromEffect(read);
      return Stream.concat(Stream.make(first), pending);
    }),
  );
});

export const connectionAtom: Atom.Atom<ConnectionReadout> = Atom.map(
  connectionLoadAtom,
  (result) =>
    AsyncResult.isFailure(result)
      ? { status: "missing" }
      : Option.getOrElse(AsyncResult.value(result), () => ({
          status: "checking",
        })),
);

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    QueryClients: QueryClients;
  }
}
