import type { Scope } from "effect";
import { Context, Effect, Layer, Stream } from "effect";

import { layerTestObsidianEnv } from "@zotlit/obsidian-kit/__fixtures__/obsidian-env.ts";
import { layerHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import type { HostSources } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import {
  layerQueryClients,
  QueryClients,
} from "@zotlit/plugin-services/core/query-client/service.ts";
import {
  layerLibraryScope,
  LibraryScope,
} from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import type { LibraryScopeState } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import {
  layerZoteroReads,
  ZoteroReads,
} from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsClient } from "@zotlit/zotero-reads/contract/rpc.ts";

import type { ParseClient } from "#core/citation-parse/client.ts";
import { CitationParse } from "#obsidian/citation-parse/service.ts";
import { layerSettings } from "./settings.ts";

import { CitationLookup, layerCitationLookup } from "#obsidian/citation-index/lookup-service.ts";
import { CitationIndex, layerCitationIndex } from "#obsidian/citation-index/service.ts";
import type { CitekeyStore } from "#core/citation-index/store.ts";
import type { LibraryScopeStub } from "#__fixtures__/citation-index/test-harness.ts";

export async function citationLookupFixture(
  deps: {
    reads: Pick<ZoteroReads["Service"], "reads" | "current" | "events">;
    libraryScope: Pick<
      LibraryScopeStub,
      "effective" | "current" | "libraries" | "changed" | "libraries-changed"
    >;
    queryClient: Pick<QueryClients["Service"], "client" | "invalidate">;
  },
  context = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  let state: LibraryScopeState = {
    current: deps.libraryScope.current,
    all: {
      mode: "all",
      invalid: false,
      available: deps.libraryScope.libraries,
      unavailable: [],
    },
    invalid: false,
    effective: deps.libraryScope.effective,
    libraryRows: null,
  };
  const runtime = buildRuntime(
    layerCitationLookup.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(
            QueryClients,
            stubService<QueryClients["Service"]>("QueryClients", {
              client: deps.queryClient.client,
              invalidate: (key) => deps.queryClient.invalidate(key),
            }),
          ),
          Layer.succeed(
            LibraryScope,
            stubService<LibraryScope["Service"]>("LibraryScope", {
              state: Effect.sync(() => state),
              effective: Effect.sync(() => deps.libraryScope.effective),
              changes: Stream.merge(
                deps.libraryScope.changed.pipe(Stream.map(() => "changed")),
                deps.libraryScope["libraries-changed"].pipe(
                  Stream.map(() => "libraries-changed"),
                ),
              ).pipe(
                Stream.map((event) => {
                  state = {
                    ...state,
                    current: deps.libraryScope.current,
                    all:
                      event === "libraries-changed"
                        ? {
                            mode: "all",
                            invalid: false,
                            available: deps.libraryScope.libraries,
                            unavailable: [],
                          }
                        : state.all,
                    effective: deps.libraryScope.effective,
                  };
                  return state;
                }),
                Stream.prepend([state]),
              ),
            }),
          ),
          Layer.succeed(
            ZoteroReads,
            stubService<ZoteroReads["Service"]>("ZoteroReads", {
              reads: deps.reads.reads,
              current: deps.reads.current,
              events: deps.reads.events,
            }),
          ),
        ),
      ),
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  await runtime.context();
  const service = Object.assign(runtime.runSync(CitationLookup), {
    runtime,
    bridge: effectBridge(runtime),
  });
  const owned = stack.move();
  return Object.assign(service, {
    runtime,
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  });
}

export const lookupFixture = Effect.fnUntraced(function* (
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
) {
  const context = yield* Effect.context<never>();
  return yield* Effect.acquireRelease(
    Effect.promise(() => openLookup(client, context)),
    (fixture) => Effect.promise(() => fixture.close()),
  );
});

async function openLookup(
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
  context: Context.Context<never>,
) {
  await using stack = new AsyncDisposableStack();
  const runtime = buildRuntime(
    layerCitationLookup.pipe(
      Layer.provideMerge(layerLibraryScope),
      Layer.provideMerge(
        Layer.mergeAll(
          layerQueryClients,
          layerZoteroReads(client),
          layerSettings({
            loadData: async () => ({ __VERSION__: 10 }),
            saveData: async () => {},
          }),
        ),
      ),
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  await runtime.context();
  const service = Object.assign(runtime.runSync(CitationLookup), {
    runtime,
    bridge: effectBridge(runtime),
  });
  const owned = stack.move();
  return { runtime, service, close: () => owned.disposeAsync() };
}

export function citationIndexFixture(
  deps: {
    host: HostSources;
    db: Pick<ZoteroReads["Service"], "current" | "snapshot">;
    libraryScope: Pick<LibraryScopeStub, "current">;
    noteIndex: Pick<NoteIndex["Service"], "getNotesByItemKey">;
    settings: {
      readonly current: PluginSettings["Service"]["current"];
      readonly changes: PluginSettings["Service"]["changes"];
    };
    lookup: CitationLookup["Service"];
    parseClient: ParseClient;
    openStore: () => Promise<CitekeyStore>;
    context?: Context.Context<never>;
  },
  stack: AsyncDisposableStack,
) {
  const runtime = buildRuntime(
    layerCitationIndex(deps.openStore).pipe(
      Layer.provide(
        Layer.mergeAll(
          layerHost(deps.host),
          layerTestObsidianEnv(),
          Layer.succeed(
            ZoteroReads,
            stubService<ZoteroReads["Service"]>("ZoteroReads", {
              current: deps.db.current,
              snapshot: deps.db.snapshot,
            }),
          ),
          Layer.succeed(
            LibraryScope,
            stubService<LibraryScope["Service"]>("LibraryScope", {
              current: Effect.sync(() => deps.libraryScope.current),
            }),
          ),
          Layer.succeed(
            NoteIndex,
            stubService<NoteIndex["Service"]>("NoteIndex", {
              getNotesByItemKey: (key) => deps.noteIndex.getNotesByItemKey(key),
            }),
          ),
          Layer.succeed(
            PluginSettings,
            stubService<PluginSettings["Service"]>("PluginSettings", {
              current: deps.settings.current,
              changes: deps.settings.changes,
            }),
          ),
          Layer.succeed(CitationLookup, deps.lookup),
          Layer.succeed(
            CitationParse,
            stubService<CitationParse["Service"]>("CitationParse", {
              parse: (request) => deps.parseClient.parse(request),
            }),
          ),
        ),
      ),
      Layer.provideMerge(Layer.succeedContext(deps.context ?? Context.empty())),
    ),
    stack,
  );
  const ready = runtime.context().then(() =>
    Object.assign(runtime.runSync(CitationIndex), {
      runtime,
      bridge: effectBridge(runtime),
    }),
  );
  return { runtime, ready, service: () => runtime.runSync(CitationIndex) };
}
