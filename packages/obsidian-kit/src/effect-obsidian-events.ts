import type { ObsidianEventEmitter } from "#obsidian-event-source.ts";
import { Effect, PubSub, Stream } from "effect";

import { logAndContinue } from "@zotlit/plugin-kernel/effect-log.ts";

import { obsidianListener } from "#obsidian-event-source.ts";

type Payload<E> = {
  [K in keyof E]: { readonly type: K; readonly args: E[K] };
}[keyof E];

export const obsidianEvents = Effect.fnUntraced(function* <
  E extends { [K in keyof E]: unknown[] },
>() {
  const bus = yield* PubSub.unbounded<Payload<E>>();
  yield* Effect.addFinalizer(() => PubSub.shutdown(bus));
  const subscription = yield* PubSub.subscribe(bus);

  let pending = 0;
  const callback =
    <K extends keyof E>(type: K) =>
    (...args: E[K]): void => {
      pending += 1;
      if (!PubSub.publishUnsafe(bus, { type, args } as Payload<E>))
        pending -= 1;
    };

  const on = Effect.fnUntraced(function* (
    type: keyof E,
    source: ObsidianEventEmitter,
    name: string,
  ) {
    return yield* obsidianListener(
      source,
      name,
      callback(type) as (...args: unknown[]) => void,
    );
  });

  const stream = Stream.fromSubscription(subscription);
  const consume = Effect.fnUntraced(function* <A, Error, R>(
    handler: (event: Payload<E>) => Effect.Effect<A, Error, R>,
  ) {
    const dispatch = Effect.fnUntraced(
      function* (event: Payload<E>) {
        pending -= 1;
        yield* handler(event);
      },
      (effect, event) =>
        effect.pipe(
          logAndContinue("Obsidian event handler failed", "obsidian-events", {
            event: event.type,
          }),
        ),
    );
    yield* Stream.runForEach(stream, (event) => dispatch(event));
  });

  return {
    stream,
    consume,
    on,
    callback,
    get pending() {
      return pending;
    },
  };
});
