import type { ExportFiles } from "#core/item-query/export-files.ts";
import type {
  Diagnostic,
  QueryCliCommand,
} from "#worker/item-query/contract.ts";
import type {
  QueryViewOutcome,
  QueryViewRequest,
} from "#worker/item-query/query-view.ts";
import type { QueryObserver } from "#worker/item-query/trace.ts";
import type {
  QueryAnswer,
  QueryCommand,
  QueryJob,
  QueryCustomFieldsCommand,
  QueryTypedJob,
  QueryViewCommand,
} from "#worker/item-query/worker-protocol.ts";
import {
  Cause,
  Context,
  Effect,
  Exit,
  Fiber,
  FiberMap,
  Layer,
  Option,
  Result,
  Schema,
  Scope,
  Stream,
} from "effect";
import type { RpcClientError } from "effect/rpc";
import { randomUUID } from "node:crypto";
import type { CliData } from "obsidian";

import type { CliRejection } from "@zotlit/obsidian-kit/cli-params.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import { awaitOwned } from "@zotlit/plugin-kernel/effect-fiber.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { isScopeClosed } from "@zotlit/plugin-kernel/effect-scope.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { libraryFilePaths } from "@zotlit/plugin-services/obsidian/library-source/paths.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { DbUnavailable } from "@zotlit/zotero-reads/contract/db-unavailable.ts";
import type {
  QueryFailed,
  SnapshotExpired,
} from "@zotlit/zotero-reads/contract/rpc.ts";

import { decodeQuery, decodeSchemaArguments, decodeValues } from "./decode.ts";
import type { DeliveryFailure } from "./delivery.ts";
import { deliverAnswer, reportCancel } from "./delivery.ts";

import {
  QUERY_COMMAND,
  QUERY_SCHEMA_COMMAND,
  QUERY_VALUES_COMMAND,
  deliveryDiagnostic,
  diagnostic,
  failure,
  queryCancelledText,
  queryIdInUseFailure,
  rejectionDiagnostic,
} from "#worker/item-query/contract.ts";

function unavailableAnswer(
  command: QueryViewCommand | QueryCustomFieldsCommand,
  unavailable: Diagnostic,
): QueryAnswer {
  return "view" in command
    ? {
        command: command.command,
        view: { kind: "failed", diagnostic: unavailable },
      }
    : { command: command.command };
}

export type ItemQueryError = SnapshotExpired | RpcClientError.RpcClientError;

export class QueryCancelled extends Schema.TaggedError<
  QueryCancelled,
  { readonly brand: unique symbol }
>()("QueryCancelled", { message: Schema.String }) {}

export type QueryMeasure = QueryObserver & { heap: boolean };

export class QueryService extends Context.Service<
  QueryService,
  {
    query(
      params: CliData,
    ): Effect.Effect<string, QueryCancelled | ItemQueryError>;
    measure(
      params: CliData,
      measure: QueryMeasure,
    ): Effect.Effect<string, QueryCancelled | ItemQueryError>;
    values(
      params: CliData,
    ): Effect.Effect<string, QueryCancelled | ItemQueryError>;
    schema(
      params: CliData,
    ): Effect.Effect<string, QueryCancelled | ItemQueryError>;
    run(
      request: QueryViewRequest,
    ): Effect.Effect<QueryViewOutcome, ItemQueryError>;
    readonly customFieldNames: Effect.Effect<readonly string[], ItemQueryError>;
    cancel(id: string): Effect.Effect<boolean>;
    readonly runningJobs: Effect.Effect<number>;
    readonly viewRuns: Effect.Effect<number>;
    readonly changed: Stream.Stream<void>;
  }
>()("zotlit/item-query/QueryService") {}

const unnamedKey = (): string => `:${randomUUID()}`;

export function layerQueryService({
  pluginVersion,
  exportFiles,
}: {
  readonly pluginVersion: string;
  readonly exportFiles: ExportFiles | undefined;
}): Layer.Layer<
  QueryService,
  never,
  ZoteroReads | ZoteroPref | LibraryScope | UseLedger | ObsidianEnv | VaultDisk
> {
  return Layer.effect(
    QueryService,
    Effect.gen(function* () {
      const { reads } = yield* ZoteroReads;
      const pref = yield* ZoteroPref;
      const libraryScope = yield* LibraryScope;
      const useLedger = yield* UseLedger;
      const env = yield* ObsidianEnv;
      const disk = yield* VaultDisk;
      const scope = yield* Scope.Scope;
      const jobs = yield* FiberMap.make<string, unknown, ItemQueryError>();
      let viewRuns = 0;

      const jobRunner = Effect.map(
        FiberMap.runtime(jobs)<never>(),
        (run) =>
          <A>(key: string, job: Effect.Effect<A, ItemQueryError>) =>
            run(key, job, { uninterruptible: true }),
      );

      const forkUnnamed = <A>(job: Effect.Effect<A, ItemQueryError>) =>
        Effect.map(jobRunner, (fork) => fork(unnamedKey(), job));

      const claim = <A>(
        job: Effect.Effect<A, ItemQueryError>,
        id: string,
      ): Effect.Effect<Fiber.Fiber<A, ItemQueryError> | undefined> =>
        Effect.map(jobRunner, (fork) =>
          FiberMap.hasUnsafe(jobs, id) ? undefined : fork(id, job),
        );

      const settle = <A>(
        fork: Effect.Effect<Fiber.Fiber<A, ItemQueryError> | undefined>,
      ): Effect.Effect<Option.Option<A> | undefined, ItemQueryError> =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const fiber = yield* fork;
            if (fiber === undefined) return undefined;
            const exit = yield* awaitOwned(fiber, restore);
            if (Exit.isSuccess(exit)) return Option.some(exit.value);
            if (Cause.hasInterruptsOnly(exit.cause)) return Option.none();
            return yield* Effect.failCause(exit.cause);
          }),
        );

      const contextOf = (id: string) =>
        Effect.gen(function* () {
          return {
            id,
            vault: { name: env.vaultName, path: disk.basePath },
            scope: yield* libraryScope.effective,
            uses: yield* useLedger.uses,
            attachmentPaths: yield* libraryFilePaths.pipe(
              Effect.provideService(ZoteroPref, pref),
            ),
          };
        });

      const jobOf = (
        command: QueryCommand,
        measure: QueryMeasure | undefined,
      ) =>
        Effect.map(
          contextOf(randomUUID()),
          (context) =>
            ({
              ...context,
              ...command,
              measure: measure !== undefined,
              ...(measure ? { heap: measure.heap } : {}),
            }) satisfies QueryJob,
        );

      const send = (
        command: QueryViewCommand | QueryCustomFieldsCommand,
      ): Effect.Effect<QueryAnswer, ItemQueryError> =>
        Effect.gen(function* () {
          const id = randomUUID();
          const call = yield* Effect.forkChild(
            reads
              .ItemQuery({
                job: {
                  ...(yield* contextOf(id)),
                  ...command,
                } satisfies QueryTypedJob,
              })
              .pipe(
                Effect.catchTags({
                  DbUnavailable: (error) =>
                    Effect.succeed(
                      unavailableAnswer(
                        command,
                        diagnostic("source-unavailable", error.message),
                      ),
                    ),
                }),
              ),
          );
          const result = yield* Effect.interruptible(Fiber.join(call)).pipe(
            Effect.onInterrupt(() =>
              reads
                .CancelItemQuery({ id })
                .pipe(Effect.ignoreCause, Effect.ensuring(Fiber.await(call))),
            ),
          );
          if (result.cancelled) return yield* Effect.interrupt;
          return result;
        });

      const job = (
        command: QueryCommand,
        measure?: QueryMeasure,
      ): Effect.Effect<string, ItemQueryError> => {
        const exported = command.schema ? undefined : command.query?.export;
        return Effect.gen(function* () {
          const job = yield* jobOf(command, measure);
          return yield* deliverAnswer({
            command: command.command,
            target:
              exported === undefined
                ? { kind: "inline" }
                : {
                    kind: "file",
                    path: exported.path,
                    format: exported.format,
                  },
            answer: reads.QueryAnswer({ job }),
            files: exportFiles,
            observer: measure,
          });
        }).pipe(
          replyFailure(command),
          Effect.onInterrupt(() => reportCancel(measure, "cleanup-finished")),
          withLogCategory("item-query"),
        );
      };

      const start = Effect.fnUntraced(function* (
        command: QueryCliCommand,
        job: Effect.Effect<string, ItemQueryError>,
        id?: string,
      ) {
        const settled = yield* settle(
          id === undefined ? forkUnnamed(job) : claim(job, id),
        );
        if (settled === undefined)
          return queryIdInUseFailure(id ?? "", command);
        if (Option.isSome(settled)) return settled.value;
        return yield* new QueryCancelled({
          message:
            id === undefined || isScopeClosed(scope)
              ? "The query was cancelled."
              : queryCancelledText(id),
        });
      });

      const query = (params: CliData, measure?: QueryMeasure) =>
        Effect.gen(function* () {
          const command = QUERY_COMMAND;
          const request = yield* decodeOrAnswer(command, decodeQuery(params));
          if (Result.isFailure(request)) return request.failure;
          const query = request.success;
          return yield* start(
            command,
            job(
              { schema: false, dataset: query.from, command, query },
              measure,
            ),
            query.id,
          );
        });

      return QueryService.of({
        query: Effect.fn("QueryService.query")((params: CliData) =>
          query(params),
        ),
        measure: Effect.fn("QueryService.measure")(
          (params: CliData, measure: QueryMeasure) => query(params, measure),
        ),
        values: Effect.fn("QueryService.values")(function* (params: CliData) {
          const command = QUERY_VALUES_COMMAND;
          const request = yield* decodeOrAnswer(command, decodeValues(params));
          if (Result.isFailure(request)) return request.failure;
          return yield* start(
            command,
            job({ schema: false, command, values: request.success }),
          );
        }),
        schema: Effect.fn("QueryService.schema")(function* (params: CliData) {
          const command = QUERY_SCHEMA_COMMAND;
          const request = yield* decodeOrAnswer(
            command,
            decodeSchemaArguments(params),
          );
          if (Result.isFailure(request)) return request.failure;
          const { from } = request.success;
          return yield* start(
            command,
            job({
              schema: true,
              ...(from === undefined ? {} : { dataset: from }),
              command,
              pluginVersion,
            }),
          );
        }),
        run: Effect.fn("QueryService.run")(function* (
          request: QueryViewRequest,
        ) {
          if (__DEV__) viewRuns++;
          const command: QueryViewCommand = {
            command: QUERY_COMMAND,
            schema: false,
            view: request,
          };
          const settled = yield* settle(
            forkUnnamed(
              send(command).pipe(
                Effect.flatMap((answer) =>
                  answer.view
                    ? Effect.succeed(answer.view)
                    : Effect.die(
                        new Error(
                          "ZotLit Query answered a typed query with text.",
                        ),
                      ),
                ),
              ),
            ),
          );
          return Option.getOrElse(
            settled ?? Option.none(),
            (): QueryViewOutcome => ({ kind: "cancelled" }),
          );
        }),
        customFieldNames: Effect.gen(function* () {
          const settled = yield* settle(
            forkUnnamed(
              send({
                command: QUERY_SCHEMA_COMMAND,
                schema: false,
                customFields: true,
              }).pipe(Effect.map((answer) => answer.customFields ?? [])),
            ),
          );
          return Option.getOrElse(
            settled ?? Option.none(),
            (): readonly string[] => [],
          );
        }).pipe(Effect.withSpan("QueryService.customFieldNames")),
        cancel: Effect.fn("QueryService.cancel")(function* (id: string) {
          if (!FiberMap.hasUnsafe(jobs, id)) return false;
          yield* Effect.forkIn(FiberMap.remove(jobs, id), scope, {
            startImmediately: true,
          });
          return true;
        }),
        runningJobs: FiberMap.size(jobs).pipe(
          Effect.withSpan("QueryService.runningJobs"),
        ),
        viewRuns: Effect.sync(() => viewRuns).pipe(
          Effect.withSpan("QueryService.viewRuns"),
        ),
        changed: useLedger.changes.pipe(
          Stream.drop(1),
          Stream.map(() => undefined),
        ),
      });
    }).pipe(withLogCategory("item-query")),
  );
}

function replyFailure(command: QueryCommand) {
  return <R>(
    reply: Effect.Effect<
      string,
      ItemQueryError | DbUnavailable | QueryFailed | DeliveryFailure,
      R
    >,
  ): Effect.Effect<string, ItemQueryError, R> =>
    reply.pipe(
      Effect.catchTags({
        DbUnavailable: (error) =>
          Effect.succeed(
            failure(
              command.command,
              diagnostic("source-unavailable", error.message),
            ),
          ),
        QueryFailed: (error) =>
          Effect.succeed(failure(command.command, error.diagnostic)),
        DeliveryFailure: ({ code, message }) =>
          Effect.succeed(
            failure(
              command.command,
              deliveryDiagnostic(code, message, command.command),
            ),
          ),
      }),
    );
}

function decodeOrAnswer<A>(
  command: QueryCliCommand,
  decode: Effect.Effect<A, CliRejection>,
): Effect.Effect<Result.Result<A, string>> {
  return decode.pipe(
    Effect.mapError((rejection) =>
      failure(command, rejectionDiagnostic(rejection)),
    ),
    Effect.result,
  );
}

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    QueryService: QueryService;
  }
}
