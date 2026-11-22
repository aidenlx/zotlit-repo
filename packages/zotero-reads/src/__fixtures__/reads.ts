import { Context, Effect, Layer, Stream } from "effect";
import type { ManagedRuntime, Scope } from "effect";
import { RpcSchema } from "effect/rpc";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";

import type { ZoteroReadsClient } from "#contract/rpc.ts";
import { acquireReadLease } from "#client/lease.ts";
import { ZoteroReads as ZoteroReadsRpc } from "#contract/rpc.ts";
import { layerZoteroReads, ZoteroReads } from "#client/service.ts";
import type { ZoteroReadsApi, ZoteroReadLease } from "#client/service.ts";

export const readsFixture = Effect.fn("readsFixture")(function* (
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
) {
  const context = yield* Effect.context<never>();
  const handle = yield* Effect.acquireRelease(
    Effect.promise(() => openReads(client, context)),
    (handle) => Effect.promise(() => handle.close()),
  );
  return handle;
});

async function openReads(
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
  context = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  const runtime = buildRuntime(
    layerZoteroReads(client).pipe(
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  await runtime.context();
  const bridge = effectBridge(runtime);
  const native = runtime.runSync(ZoteroReads);
  const service = Object.assign(native, {
    runtime,
    bridge,
    acquireRead: () => acquireReadLease(native, bridge),
  });
  const owned = stack.move();
  return { runtime, service, close: () => owned.disposeAsync() };
}

export type TestReads = ZoteroReads["Service"] &
  AsyncDisposable & {
    runtime: ManagedRuntime.ManagedRuntime<ZoteroReads, never>;
    bridge: EffectBridge;
    acquireRead(): Promise<ZoteroReadLease>;
    ready: Promise<{ reads: ZoteroReadsApi; client: ZoteroReadsApi }>;
  };

export function testReads(
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
): TestReads {
  const stack = new AsyncDisposableStack();
  const runtime = buildRuntime(layerZoteroReads(client), stack);
  let native: ZoteroReads["Service"] | undefined;
  let bridge: EffectBridge;
  const loaded = runtime.context().then(() => {
    bridge = effectBridge(runtime);
    return (native = runtime.runSync(ZoteroReads));
  });
  const service = Effect.promise(() => loaded);
  const reads: Record<string, unknown> = {};
  for (const [tag, rpc] of ZoteroReadsRpc.requests) {
    if (
      [
        "Changes",
        "Snapshot",
        "Refresh",
        "NotifyExternalChange",
        "Configure",
        "Ping",
      ].includes(tag)
    )
      continue;
    const invoke = (...args: unknown[]) =>
      Effect.map(
        Effect.promise(() => loaded),
        (native) =>
          (
            native.reads[tag as keyof ZoteroReadsApi] as (
              ...args: unknown[]
            ) => unknown
          )(...args),
      );
    reads[tag] = RpcSchema.isStreamSchema(rpc.successSchema)
      ? (...args: unknown[]) =>
          Stream.unwrap(
            invoke(...args) as Effect.Effect<Stream.Stream<unknown>>,
          )
      : (...args: unknown[]) =>
          Effect.flatten(
            invoke(...args) as Effect.Effect<Effect.Effect<unknown>>,
          );
  }
  const api = reads as unknown as ZoteroReadsApi;
  return {
    ready: loaded.then(() => ({ reads: api, client: api })),
    reads: api,
    current: Effect.suspend(
      () =>
        native?.current ??
        Effect.succeed({
          state: "loading" as const,
          error: null,
          moved: false,
          dbFileMissing: false,
          activeReadMode: null,
        }),
    ),
    snapshot: Effect.flatMap(service, (reads) => reads.snapshot),
    refresh: Effect.flatMap(service, (reads) => reads.refresh),
    notifyExternalChange: Effect.flatMap(
      service,
      (reads) => reads.notifyExternalChange,
    ),
    changes: Stream.unwrap(Effect.map(service, (reads) => reads.changes)),
    events: Stream.unwrap(Effect.map(service, (reads) => reads.events)),
    acquireRead: async () => acquireReadLease(await loaded, bridge),
    get bridge() {
      return bridge;
    },
    runtime,
    [Symbol.asyncDispose]: async () => {
      await loaded;
      await stack.disposeAsync();
    },
  };
}

export type ReadsAnswers = {
  readonly [K in keyof ZoteroReadsApi]?: (
    input: Parameters<ZoteroReadsApi[K]>[0],
  ) => ReturnType<ZoteroReadsApi[K]>;
};

export function readsAnswering(answers: ReadsAnswers): ZoteroReadsApi {
  return stubService<ZoteroReadsApi>(
    "ZoteroReadsApi",
    answers as Partial<ZoteroReadsApi>,
  );
}
