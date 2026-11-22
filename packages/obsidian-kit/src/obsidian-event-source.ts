import { Effect, PubSub, Stream } from "effect";
import type { Events } from "obsidian";

export type ObsidianEventEmitter = Pick<Events, "on" | "offref">;

export function obsidianListener(
  source: ObsidianEventEmitter,
  name: string,
  callback: (...args: unknown[]) => void,
) {
  return Effect.acquireRelease(
    Effect.sync(() => source.on(name, callback)),
    (ref) => Effect.sync(() => source.offref(ref)),
  );
}

export const obsidianEventSource = Effect.fnUntraced(function* <
  Event extends { readonly _tag: string },
>() {
  const bus = yield* PubSub.unbounded<Event>();
  yield* Effect.addFinalizer(() => PubSub.shutdown(bus));

  const listen = <Args extends unknown[]>(
    source: ObsidianEventEmitter,
    name: string,
    toEvent: (...args: Args) => Event,
  ) =>
    obsidianListener(source, name, (...args) => {
      PubSub.publishUnsafe(bus, toEvent(...(args as Args)));
    });

  return {
    listen,
    stream: Stream.fromPubSub(bus),
  };
});
