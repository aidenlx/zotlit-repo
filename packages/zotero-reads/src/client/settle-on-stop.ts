import { Deferred, Effect, Fiber, Schema, Stream } from "effect";
import type { Scope } from "effect";
import { RpcClientError, RpcSchema } from "effect/rpc";

import { isScopeClosed } from "@zotlit/plugin-kernel/effect-scope.ts";

import { DbUnavailable } from "#contract/db-unavailable.ts";

interface Group {
  readonly requests: ReadonlyMap<
    string,
    { readonly errorSchema: Schema.Top; readonly successSchema: Schema.Top }
  >;
}

export function noWorker(reason: DbUnavailable): RpcClientError.RpcClientError {
  return new RpcClientError.RpcClientError({
    reason: new RpcClientError.RpcClientDefect({
      message: reason.message,
      cause: reason,
    }),
  });
}

export function stoppedErrors(
  group: Group,
): (
  tag: string,
  reason: DbUnavailable,
) => DbUnavailable | RpcClientError.RpcClientError {
  const typed = new Set(
    Array.from(group.requests)
      .filter(([, rpc]) =>
        Schema.is(
          RpcSchema.isStreamSchema(rpc.successSchema)
            ? rpc.successSchema.error
            : rpc.errorSchema,
        )(new DbUnavailable({ message: "" })),
      )
      .map(([tag]) => tag),
  );
  return (tag, reason) => (typed.has(tag) ? reason : noWorker(reason));
}

export interface StopSignal<E> {
  readonly stopped: Deferred.Deferred<DbUnavailable>;
  readonly onStop: (reason: DbUnavailable) => E;
  readonly scope: Scope.Scope;
}

const stopBefore = (
  stopped: Deferred.Deferred<DbUnavailable>,
  scope: Scope.Scope,
): Effect.Effect<DbUnavailable | null> =>
  Effect.suspend(() =>
    Deferred.isDoneUnsafe(stopped)
      ? Deferred.await(stopped)
      : Effect.succeed(
          isScopeClosed(scope)
            ? new DbUnavailable({ message: "The database worker stopped" })
            : null,
        ),
  );

export const untilStopped = <A, E, E2>(
  request: Effect.Effect<A, E>,
  { stopped, onStop, scope }: StopSignal<E2>,
): Effect.Effect<A, E | E2> =>
  Effect.gen(function* () {
    const early = yield* stopBefore(stopped, scope);
    if (early) return yield* Effect.fail(onStop(early));
    const answer = yield* Deferred.make<A, E | E2>();
    const asked = yield* Effect.forkIn(Deferred.into(request, answer), scope, {
      startImmediately: true,
    });
    const watch = yield* Effect.forkIn(
      Effect.flatMap(Deferred.await(stopped), (reason) =>
        Effect.flatMap(Deferred.fail(answer, onStop(reason)), (settled) =>
          settled
            ? Effect.asVoid(Effect.forkIn(Fiber.interrupt(asked), scope))
            : Effect.void,
        ),
      ),
      scope,
      { startImmediately: true },
    );
    return yield* Deferred.await(answer).pipe(
      Effect.onInterrupt(() => Fiber.interrupt(asked)),
      Effect.ensuring(Fiber.interrupt(watch)),
    );
  });

export const streamUntilStopped = <A, E, E2>(
  stream: Stream.Stream<A, E>,
  { stopped, onStop, scope }: StopSignal<E2>,
): Stream.Stream<A, E | E2> => {
  const stop = Effect.flatMap(Deferred.await(stopped), (reason) =>
    Effect.fail(onStop(reason)),
  );
  return Stream.unwrap(
    Effect.map(stopBefore(stopped, scope), (early) =>
      early ? Stream.fail(onStop(early)) : Stream.interruptWhen(stream, stop),
    ),
  );
};

export interface Settled<Client, E> {
  readonly client: Client;
  readonly stop: StopSignal<E>;
}

export interface StreamOptions {
  readonly asQueue?: boolean;
  readonly streamBufferSize?: number;
}

export const streamOrQueue = <A, E, R>(
  stream: Stream.Stream<A, E, R>,
  options: StreamOptions | undefined,
) =>
  options?.asQueue
    ? Stream.toQueue(stream, { capacity: options.streamBufferSize ?? 16 })
    : stream;

export function settledRequests<Client extends object, E>(
  group: Group,
  connect: (tag: string) => Effect.Effect<Settled<Client, E>, E>,
): Client {
  const settled: Record<string, unknown> = {};
  for (const [tag, rpc] of group.requests) {
    const call = (client: Client, payload: unknown, options: unknown) =>
      (
        client as unknown as Record<
          string,
          (payload: unknown, options: unknown) => unknown
        >
      )[tag]!(payload, options);
    settled[tag] = RpcSchema.isStreamSchema(rpc.successSchema)
      ? (payload: unknown, options?: StreamOptions) => {
          const stream = ({ client, stop }: Settled<Client, E>) =>
            streamUntilStopped(
              call(client, payload, {
                ...options,
                asQueue: false,
              }) as Stream.Stream<unknown, unknown>,
              stop,
            );
          return options?.asQueue
            ? Effect.flatMap(connect(tag), (connection) =>
                Stream.toQueue(stream(connection), {
                  capacity: options.streamBufferSize ?? 16,
                }),
              )
            : Stream.unwrap(
                Effect.map(connect(tag), (connection) => stream(connection)),
              );
        }
      : (payload: unknown, options: unknown) =>
          Effect.flatMap(connect(tag), ({ client, stop }) =>
            untilStopped(
              call(client, payload, options) as Effect.Effect<unknown, unknown>,
              stop,
            ),
          );
  }
  return settled as Client;
}

export function settledOnStop<Client extends object, E>(
  group: Group,
  client: Client,
  {
    stopped,
    onStop,
    scope,
  }: Omit<StopSignal<E>, "onStop"> & {
    readonly onStop: (tag: string, reason: DbUnavailable) => E;
  },
): Client {
  return {
    ...client,
    ...settledRequests(group, (tag) =>
      Effect.succeed({
        client,
        stop: { stopped, onStop: (reason) => onStop(tag, reason), scope },
      }),
    ),
  };
}
