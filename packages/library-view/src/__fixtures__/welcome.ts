// A Welcome test host over in-memory Obsidian sources and controllable Effect services.
import { Effect, Layer, Stream } from "effect";

import { TemplateMigration } from "@zotlit/notes/desktop/template/migration.ts";
import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { layerHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import type { HostSources } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { makeViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import { testEvent } from "@zotlit/plugin-kernel/__fixtures__/event-stream.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import { yieldToMain } from "@zotlit/plugin-kernel/yield-to-main.ts";
import { layerQueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type {
  ZoteroReadsEvent,
  ZoteroReadsState,
} from "@zotlit/zotero-reads/client/service.ts";

import { layerUnreadViewServices } from "./view-atoms.ts";
import { Release } from "#obsidian/release/service.ts";
import { layerSettings } from "#__fixtures__/settings.ts";

import { connectionLifecycleAtom } from "#desktop/welcome/connection.ts";
import { holdWelcomeModel, makeWelcomeModel } from "#desktop/welcome/model.ts";

export async function waitFor(assertion: () => void): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      if (attempt === 999) throw error;
      await yieldToMain();
    }
  }
}

export interface WelcomeHostOptions<R = never> {
  readonly sources?: HostSources;
  readonly services?: Layer.Layer<R>;
  readonly dataDir?: string;
  readonly count?: (signal: AbortSignal) => Promise<{ itemCount: number }>;
  /** What the Zotero add-on list says each time it is read. */
  readonly companionInstalled?: () => boolean;
}

export async function makeWelcomeHost<R = never>(
  options: WelcomeHostOptions<R> = {},
) {
  await using stack = new AsyncDisposableStack();
  const events = testEvent<ZoteroReadsEvent>();
  const states = testEvent<ZoteroReadsState>();
  let current: ZoteroReadsState = {
    state: "ready",
    error: null,
    moved: false,
    dbFileMissing: false,
    activeReadMode: null,
  };
  let reads = 0;
  const runtime = buildRuntime(
    Layer.mergeAll(
      layerUnreadViewServices,
      layerHost(options.sources),
      layerQueryClients,
      testNotifier().layer,
      layerSettings({
        loadData: async () => null,
        saveData: async () => {},
      }),
      Layer.mock(Release, {
        version: "2.2.0",
        hasV1Templates: () => Effect.succeed(false),
        acknowledgeMigration: Effect.void,
        acknowledgeUpdate: Effect.void,
        openReleaseNote: Effect.void,
      }),
      Layer.mock(TemplateMigration, {}),
      Layer.mock(ZoteroPref, {
        current: Effect.succeed(
          stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
            dataDir: options.dataDir ?? "/Zotero",
          }),
        ),
        changes: Stream.never,
        companionInstalled: Effect.sync(
          () => options.companionInstalled?.() ?? false,
        ),
      }),
      Layer.mock(ZoteroReads, {
        current: Effect.sync(() => current),
        changes: Stream.concat(
          Stream.suspend(() => Stream.make(current)),
          states.stream,
        ),
        events: events.stream,
        reads: stubService<ZoteroReads["Service"]["reads"]>("ZoteroReadsApi", {
          ConnectionReadout: <
            const _AsQueue extends boolean = false,
            const Discard = false,
          >(
            _input: object,
            rpcOptions?: { readonly discard?: Discard },
          ) =>
            Effect.map(
              Effect.promise((signal) => {
                reads += 1;
                return (
                  options.count?.(signal) ?? Promise.resolve({ itemCount: 3 })
                );
              }),
              (value) =>
                (rpcOptions?.discard
                  ? undefined
                  : value) as Discard extends true
                  ? void
                  : { readonly itemCount: number },
            ),
        }),
      }),
      options.services ?? Layer.empty,
    ),
    stack,
  );
  const context = await runtime.context();
  const registry = makeViewRegistry(context, { idleTTL: 0 });
  stack.defer(() => registry.dispose());
  // The plugin holds invalidation even while every Library leaf is closed.
  stack.defer(registry.mount(connectionLifecycleAtom));
  const lifetime = stack.move();
  return {
    registry,
    context,
    reads: () => reads,
    publish: (
      event: ZoteroReadsEvent,
      patch: Partial<ZoteroReadsState> = {},
    ) => {
      current = { ...current, ...patch };
      states.emit(current);
      events.emit(event);
    },
    subscribers: () => events.subscribers,
    openSession: () => {
      const model = makeWelcomeModel();
      const release = holdWelcomeModel(registry, model);
      return {
        model,
        state: () => registry.get(model.state),
        [Symbol.dispose]: release,
      };
    },
    close: () => lifetime.disposeAsync(),
    [Symbol.asyncDispose]: () => lifetime.disposeAsync(),
  };
}
