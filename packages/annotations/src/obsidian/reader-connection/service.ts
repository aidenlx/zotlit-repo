import { Context, Effect, Layer, PubSub, SubscriptionRef } from "effect";
import type { Stream } from "effect";

import type {
  ConnectHandlers,
  ReaderApi,
  RefuseReason,
} from "@zotlit/reader-api";

export type ReaderConnectionState =
  | { readonly status: "connected"; readonly api: ReaderApi }
  | { readonly status: "absent" }
  | { readonly status: "incompatible"; readonly reason: RefuseReason };

export type ReaderSource = (handlers: ConnectHandlers) => () => void;

export class ReaderConnection extends Context.Service<
  ReaderConnection,
  {
    readonly current: Effect.Effect<ReaderConnectionState>;
    readonly changes: Stream.Stream<ReaderConnectionState>;
  }
>()("zotlit/reader-connection/ReaderConnection") {}

const ABSENT: ReaderConnectionState = { status: "absent" };

export const layerReaderConnection = (source: ReaderSource) =>
  Layer.effect(
    ReaderConnection,
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make<ReaderConnectionState>(ABSENT);
      yield* Effect.addFinalizer(() => PubSub.shutdown(state.pubsub));
      const run = Effect.runSyncWith(yield* Effect.context<never>());
      let offClose: (() => void) | null = null;
      const enter = (next: ReaderConnectionState) => {
        offClose?.();
        offClose = null;
        run(SubscriptionRef.set(state, next));
      };
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          source({
            onAccept: (api) => {
              enter({ status: "connected", api });
              offClose = api.onClose(() => enter(ABSENT));
            },
            onRefuse: (reason) => enter({ status: "incompatible", reason }),
            onAbsent: () => enter(ABSENT),
          }),
        ),
        (unsubscribe) =>
          Effect.sync(() => {
            unsubscribe();
            offClose?.();
            offClose = null;
          }),
      );
      return ReaderConnection.of({
        current: SubscriptionRef.get(state),
        changes: SubscriptionRef.changes(state),
      });
    }),
  );
