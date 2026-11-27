import type {
  ChangeEvent,
  FileReadsConfig,
  ReadsConfig,
} from "#contract/rpc.ts";
import type { SourceIdentity } from "#contract/source-identity.ts";
import {
  Context,
  Duration,
  Effect,
  Layer,
  Predicate,
  RcRef,
  Ref,
  Schema,
} from "effect";
import type { Stream } from "effect";
import type { Scope } from "effect";

import { getZoteroDatabaseIdentity, getZoteroIdentity } from "@zotlit/db";
import type { ZoteroDatabase } from "@zotlit/db";
import {
  checkDatabaseLayout,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";

import { makeChangeFeed } from "#contract/change-feed.ts";
import { DbUnavailable, fileConfigOf } from "#contract/rpc.ts";
import { webApiSourceId } from "#contract/source-identity.ts";

export class Connection extends Context.Service<
  Connection,
  {
    readonly borrow: Effect.Effect<ZoteroDatabase, DbUnavailable, Scope.Scope>;
    readonly changes: Stream.Stream<ChangeEvent>;
    readonly refresh: Effect.Effect<void, DbUnavailable>;
    readonly notifyExternalChange: Effect.Effect<void>;
    readonly configure: (config: ReadsConfig) => Effect.Effect<void>;
    readonly databaseGeneration: (client: ZoteroDatabase) => number;
    readonly identity: (
      client: ZoteroDatabase,
    ) => Effect.Effect<SourceIdentity, DbUnavailable>;
    readonly pendingIdentity?: Effect.Effect<SourceIdentity | null>;
  }
>()("zotlit/zotero-reads/Connection") {}

export function makeDatabaseGenerations() {
  const generations = new Map<string, number>();
  const clientGenerations = new WeakMap<ZoteroDatabase, number>();
  const clientFiles = new WeakMap<ZoteroDatabase, string | null>();
  const record = Effect.fnUntraced(function* (
    open: OpenClient,
    file: string | null,
  ): Effect.fn.Return<void, DbUnavailable> {
    const { client } = open;
    const identity = yield* Effect.try({
      try: () => getZoteroDatabaseIdentity(client),
      catch: toDbUnavailable,
    }).pipe(Effect.tapError(() => closeQuietly(open)));
    const key = JSON.stringify([
      file,
      identity.userID,
      identity.localUserKey,
      identity.serverID,
    ]);
    let generation = generations.get(key);
    if (generation === undefined) {
      generation = generations.size + 1;
      generations.set(key, generation);
    }
    clientGenerations.set(client, generation);
    clientFiles.set(client, file);
  });
  return {
    record,
    databaseGeneration: (client: ZoteroDatabase): number => {
      const generation = clientGenerations.get(client);
      if (generation === undefined)
        throw new DbUnavailable({
          message: "The client was not opened by this connection",
        });
      return generation;
    },
    databaseFile: (client: ZoteroDatabase): string | null =>
      clientFiles.get(client) ?? null,
  };
}

export type ConnectionOpener = (config: FileReadsConfig | null) => OpenClient;

export function toDbUnavailable(cause: unknown): DbUnavailable {
  let error = cause;
  while (error instanceof Error && error.cause instanceof Error) {
    error = error.cause;
  }
  return new DbUnavailable({
    message: error instanceof Error ? error.message : String(error),
  });
}

export function read<A>(
  client: ZoteroDatabase,
  f: (client: ZoteroDatabase) => A,
): Effect.Effect<A, DbUnavailable> {
  return Effect.try({ try: () => f(client), catch: toDbUnavailable });
}

export class ClientValidationError extends Schema.TaggedError<
  ClientValidationError,
  { readonly brand: unique symbol }
>()("ClientValidationError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export const validateClient = Effect.fnUntraced(function* (
  open: OpenClient,
): Effect.fn.Return<OpenClient, ItemQueryLayoutError | ClientValidationError> {
  const { client } = open;
  yield* Effect.try({
    try: () => checkDatabaseLayout(client),
    catch: (error) =>
      error instanceof ItemQueryLayoutError
        ? error
        : new ClientValidationError({
            message: Error.isError(error) ? error.message : String(error),
            cause: error,
          }),
  }).pipe(Effect.tapError(() => closeQuietly(open)));
  return open;
});

function openValidated(
  opener: ConnectionOpener,
  config: FileReadsConfig | null,
): Effect.Effect<OpenClient, DbUnavailable> {
  return Effect.try({
    try: () => opener(config),
    catch: toDbUnavailable,
  }).pipe(
    Effect.flatMap((open) =>
      validateClient(open).pipe(
        Effect.mapError((cause) => toDbUnavailable(cause)),
      ),
    ),
  );
}

export interface OpenClient {
  readonly client: ZoteroDatabase;
  readonly close: Effect.Effect<void>;
}

function closeQuietly(open: OpenClient): Effect.Effect<void> {
  return open.close.pipe(Effect.catchDefect(() => Effect.void));
}

export const makeClientRef = Effect.fnUntraced(function* (
  fallback: Effect.Effect<OpenClient, DbUnavailable>,
) {
  const staged = yield* Ref.make<OpenClient | null>(null);
  const ref = yield* RcRef.make({
    acquire: Effect.acquireRelease(
      Ref.getAndSet(staged, null).pipe(
        Effect.filterOrElse(Predicate.isNotNull, () => fallback),
      ),
      (open) => open.close,
    ),
    idleTimeToLive: Duration.infinity,
  });
  yield* Effect.addFinalizer(() =>
    Ref.getAndSet(staged, null).pipe(
      Effect.flatMap((left) => (left ? left.close : Effect.void)),
    ),
  );
  return {
    borrow: Effect.map(RcRef.get(ref), (open) => open.client),
    swap: (next: OpenClient) =>
      Ref.getAndSet(staged, next).pipe(
        Effect.flatMap((replaced) =>
          Effect.andThen(
            RcRef.invalidate(ref),
            replaced ? replaced.close : Effect.void,
          ),
        ),
      ),
  };
});

export function layerRcRef(opener: ConnectionOpener): Layer.Layer<Connection> {
  return Layer.effect(Connection)(
    Effect.gen(function* () {
      const config = yield* Ref.make<FileReadsConfig | null>(null);
      const status = yield* Ref.make<{
        state: "loading" | "ready" | "degraded";
        lastError: DbUnavailable | null;
        serving: string | null;
        moved: boolean;
      }>({
        state: "loading",
        lastError: null as DbUnavailable | null,
        serving: null,
        moved: false,
      });
      const databaseGenerations = makeDatabaseGenerations();
      const openRecorded = Ref.get(config).pipe(
        Effect.flatMap((current) => {
          const opened = current?.databasePath ?? null;
          return Effect.tap(openValidated(opener, current), (open) =>
            databaseGenerations.record(open, opened),
          );
        }),
      );
      const { publish, changes } = yield* makeChangeFeed(() => {
        const current = Ref.getUnsafe(status);
        return [
          {
            _tag: "state",
            state: current.state,
            error: current.lastError,
            ...(current.lastError !== null &&
              current.state !== "degraded" && { moved: current.moved }),
          },
        ];
      });

      const openDirect = openRecorded.pipe(
        Effect.tap((open) =>
          Ref.update(status, (current) => ({
            ...current,
            serving: databaseGenerations.databaseFile(open.client),
          })),
        ),
        Effect.tap(() =>
          Effect.gen(function* () {
            const wasReady = (yield* Ref.get(status)).state === "ready";
            yield* Ref.update(status, (current) => ({
              ...current,
              state: "ready" as const,
              lastError: null,
              moved: false,
            }));
            if (!wasReady) yield* publish({ _tag: "changed" });
          }),
        ),
        Effect.tapError((error) =>
          Effect.gen(function* () {
            const wasDegraded = (yield* Ref.get(status)).state === "degraded";
            yield* Ref.update(status, (current) => ({
              ...current,
              state: "degraded" as const,
              lastError: error,
            }));
            if (!wasDegraded) yield* publish({ _tag: "degraded", error });
          }),
        ),
      );
      const clients = yield* makeClientRef(openDirect);

      const swapIn = Effect.uninterruptible(
        Effect.flatMap(openRecorded, (open) =>
          Effect.gen(function* () {
            yield* Ref.update(status, (current) => ({
              ...current,
              state: "ready" as const,
              lastError: null,
              moved: false,
              serving: databaseGenerations.databaseFile(open.client),
            }));
            yield* clients.swap(open);
          }),
        ),
      );

      const refresh = Effect.gen(function* () {
        yield* publish({ _tag: "refreshing", active: true });
        const result = yield* Effect.result(swapIn);
        if (result._tag === "Failure") {
          const currentConfig = yield* Ref.get(config);
          const current = yield* Ref.modify(status, (before) => [
            {
              moved: (currentConfig?.databasePath ?? null) !== before.serving,
            },
            {
              ...before,
              lastError: result.failure,
              moved: (currentConfig?.databasePath ?? null) !== before.serving,
            },
          ]);
          yield* publish({
            _tag: "refresh-failed",
            error: result.failure,
            moved: current.moved,
          });
          yield* publish({ _tag: "refreshing", active: false });
          return yield* result.failure;
        }
        yield* publish({ _tag: "changed" });
        yield* publish({ _tag: "refreshing", active: false });
      });

      return Connection.of({
        borrow: clients.borrow,
        changes,
        refresh,
        notifyExternalChange: Effect.ignore(refresh),
        configure: Effect.fn("Connection.configure")(function* (next) {
          const file = fileConfigOf(next);
          const previous = yield* Ref.getAndSet(config, file);
          if (
            previous === null ||
            file === null ||
            file.databasePath !== previous.databasePath ||
            file.readMode !== previous.readMode
          )
            yield* Effect.ignore(refresh);
        }),
        databaseGeneration: databaseGenerations.databaseGeneration,
        identity: (client) =>
          Effect.map(Ref.get(config), (current) =>
            fileSourceIdentity(
              databaseGenerations.databaseFile(client),
              current,
            ),
          ),
      });
    }),
  );
}

export function fileSourceIdentity(
  served: string | null,
  config: FileReadsConfig | null,
): SourceIdentity {
  return {
    kind: "file",
    id:
      served !== null && config !== null && served === config.databasePath
        ? (config.sourceId ?? null)
        : null,
    databasePath: served,
  };
}

export const webApiSourceIdentity = (
  client: ZoteroDatabase,
): Effect.Effect<SourceIdentity, DbUnavailable> =>
  Effect.try({
    try: () => {
      const { userID, username } = getZoteroIdentity(client);
      return {
        kind: "web-api" as const,
        id: webApiSourceId(userID),
        userID,
        username,
      };
    },
    catch: toDbUnavailable,
  });
