import type { Scope } from "effect";
import { Cause, Effect, Exit, Latch, PubSub, Stream } from "effect";
import { RpcSchema } from "effect/rpc";

import { streamOrQueue } from "@zotlit/zotero-reads/client/settle-on-stop.ts";
import type { StreamOptions } from "@zotlit/zotero-reads/client/settle-on-stop.ts";
import type {
  ChangeEvent,
  ZoteroReadsClient,
} from "@zotlit/zotero-reads/contract/rpc.ts";
import {
  DbUnavailable,
  ZoteroReads as ZoteroReadsRpc,
} from "@zotlit/zotero-reads/contract/rpc.ts";

export interface ReadsFacade {
  readonly client: ZoteroReadsClient;
  attach(
    client: ZoteroReadsClient,
    stopped: DbUnavailable,
    lost: Effect.Effect<void>,
  ): Effect.Effect<void, never, Scope.Scope>;
  absent(error: DbUnavailable): Effect.Effect<void>;
}

const answerWithoutWorker: Partial<
  Record<keyof ZoteroReadsClient, (error: DbUnavailable) => unknown>
> = {
  CancelItemQuery: () => Effect.void,
  NotifyExternalChange: () => Effect.void,
  Configure: () => Effect.void,
  Ping: () => Effect.void,
  CheckChineseSegmenter: (error) =>
    Effect.succeed({ kind: "failed", detail: error.message }),
};

function replayed(before: ChangeEvent, event: ChangeEvent): ChangeEvent {
  switch (event._tag) {
    case "state":
      return event;
    case "changed":
      return { _tag: "state", state: "ready", error: null };
    case "degraded":
      return { _tag: "state", state: "degraded", error: event.error };
    default:
      return before;
  }
}

export const makeReadsFacade = Effect.fnUntraced(function* (
  starting: DbUnavailable = new DbUnavailable({
    message: "The online library is starting",
  }),
) {
  let current: ZoteroReadsClient | null = null;
  let error = starting;
  let state: ChangeEvent = { _tag: "state", state: "loading", error: null };
  const decided = yield* Latch.make(false);
  const bus = yield* Effect.acquireRelease(
    PubSub.unbounded<ChangeEvent>(),
    (pubsub) => PubSub.shutdown(pubsub),
  );
  const publish = (event: ChangeEvent) =>
    Effect.suspend(() => {
      state = replayed(state, event);
      return PubSub.publish(bus, event);
    });

  const client: Record<string, unknown> = {};
  for (const [tag, rpc] of ZoteroReadsRpc.requests) {
    const name = tag as keyof ZoteroReadsClient;
    const stream = RpcSchema.isStreamSchema(rpc.successSchema);
    const fallback = answerWithoutWorker[name];
    const call = (payload?: object, options?: StreamOptions): unknown => {
      const target = current?.[name] as
        | ((payload?: object, options?: object) => unknown)
        | undefined;
      if (target) return target(payload, options);
      if (fallback) return fallback(error);
      if (!stream) return Effect.fail(error);
      return streamOrQueue(Stream.fail(error), options);
    };
    const answer = (payload?: object, options?: StreamOptions) =>
      Effect.andThen(
        decided.await,
        Effect.suspend(() => call(payload, options) as Effect.Effect<unknown>),
      );
    client[tag] = stream
      ? (payload?: object, options?: StreamOptions) =>
          options?.asQueue
            ? answer(payload, options)
            : Stream.unwrap(
                Effect.andThen(
                  decided.await,
                  Effect.sync(
                    () => call(payload, options) as Stream.Stream<unknown>,
                  ),
                ),
              )
      : answer;
  }
  client.Changes = (_payload?: object, options?: StreamOptions) =>
    streamOrQueue(
      Stream.unwrap(
        Effect.map(PubSub.subscribe(bus), (subscription) =>
          Stream.concat(
            Stream.succeed(state),
            Stream.fromSubscription(subscription),
          ),
        ),
      ),
      options,
    );

  const absent = (next: DbUnavailable) =>
    Effect.suspend(() => {
      current = null;
      error = next;
      return Effect.andThen(
        publish({ _tag: "state", state: "degraded", error: next }),
        decided.open,
      );
    });

  const attach = (
    next: ZoteroReadsClient,
    stopped: DbUnavailable,
    lost: Effect.Effect<void>,
  ) =>
    Effect.gen(function* () {
      let first = true;
      yield* Effect.addFinalizer(() =>
        current === next ? absent(stopped) : Effect.void,
      );
      current = next;
      yield* decided.open;
      yield* Stream.runForEach(next.Changes(), (event) =>
        Effect.gen(function* () {
          yield* publish(event);
          if (first && event._tag === "state" && event.state === "ready")
            yield* publish({ _tag: "changed" });
          first = false;
        }),
      ).pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
            ? Effect.void
            : lost,
        ),
        Effect.forkScoped({ startImmediately: true }),
      );
    });

  return {
    client: client as unknown as ZoteroReadsClient,
    attach,
    absent,
  } satisfies ReadsFacade;
});

export function unavailable(message: string): DbUnavailable {
  return new DbUnavailable({ message });
}
