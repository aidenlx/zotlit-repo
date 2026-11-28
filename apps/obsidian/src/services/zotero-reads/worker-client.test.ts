import { it } from "@effect/vitest";
import {
  Context,
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Queue,
  Ref,
  Stream,
} from "effect";
import { RpcGroup, RpcServer, RpcWorker } from "effect/rpc";
import { TestClock } from "effect/testing";
import { expect, vi } from "vitest";

import { testObsidianEnv } from "@zotlit/obsidian-kit/__fixtures__/obsidian-env.ts";
import { MemoryWorkspace } from "@zotlit/obsidian-kit/__fixtures__/obsidian-workspace.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import {
  layerWorkspaceFrom,
  Workspace,
} from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { zoteroPrefFixture } from "@zotlit/plugin-services/desktop/zotero-pref/__fixtures__.ts";
import {
  layerPackDevice,
  packDevice,
  packFile,
} from "@zotlit/plugin-services/obsidian/managed-binary/__fixtures__.ts";
import { ResourcePackPlatform } from "@zotlit/plugin-services/obsidian/managed-binary/pack-platform.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import type {
  QueryJob,
  QueryTypedJob,
} from "@zotlit/query-views/worker/item-query/worker-protocol.ts";
import { MY_LIBRARY_SCOPE } from "@zotlit/zotero-reads/contract/library-scope.ts";
import {
  WorkerInitSchema,
  ZoteroReads,
} from "@zotlit/zotero-reads/contract/rpc.ts";
import type { FileReadsConfig } from "@zotlit/zotero-reads/contract/rpc.ts";
import { launchWorker } from "@zotlit/zotero-reads/worker/worker-launch.ts";

import { settingsOf } from "@/services/settings/__fixtures__.ts";

import { workerClient } from "./worker-client.ts";

vi.mock("virtual:zotero-reads-worker", () => ({ default: "" }));

const EMPTY_MODULE = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);

const workerFixture = Effect.fn("workerFixture")(function* (installed = false) {
  const spawned = yield* Queue.unbounded<StandInWorker>();
  const configured = yield* Queue.unbounded<FileReadsConfig>();
  const initial = yield* Queue.unbounded<
    FileReadsConfig & { readonly deferOpen: boolean }
  >();
  const refreshed = yield* Queue.unbounded<void>();
  const events: string[] = [];
  let configuring = 0;
  const holdConfigure = yield* Ref.make<Deferred.Deferred<void> | null>(null);
  const changesEnd = yield* Deferred.make<void>();
  const run = Effect.runSyncWith(yield* Effect.context<never>());
  const group = RpcGroup.make(
    ...Array.from(ZoteroReads.requests.values()).filter(
      (rpc) =>
        rpc._tag === "Configure" ||
        rpc._tag === "ItemQuery" ||
        rpc._tag === "QueryAnswer" ||
        rpc._tag === "NoteRefs" ||
        rpc._tag === "SourceIdentity" ||
        rpc._tag === "Refresh" ||
        rpc._tag === "Changes" ||
        rpc._tag === "Ping",
    ),
  );
  class StandInWorker extends EventTarget {
    readonly endpoint = new EventTarget();
    readonly pending: unknown[] = [];
    listening = false;
    constructor() {
      super();
      run(Queue.offer(spawned, this));
    }
    launch() {
      launchWorker(
        {
          addEventListener: this.endpoint.addEventListener.bind(this.endpoint),
          removeEventListener: this.endpoint.removeEventListener.bind(
            this.endpoint,
          ),
          postMessage: (data) => {
            this.dispatchEvent(new MessageEvent("message", { data }));
            if (Array.isArray(data) && data[0] === 0) {
              this.listening = true;
              for (const message of this.pending.splice(0))
                this.postMessage(message);
            }
          },
          close: () => undefined,
        },
        RpcServer.layer(group).pipe(
          Layer.provide(
            Layer.unwrap(
              RpcWorker.initialMessage(WorkerInitSchema).pipe(
                Effect.orDie,
                Effect.tap((config) => Queue.offer(initial, config)),
                Effect.as(
                  group.toLayer({
                    Configure: (config) =>
                      Effect.gen(function* () {
                        const file = config as FileReadsConfig;
                        events.push(`configure ${file.databasePath}`);
                        configuring++;
                        yield* Queue.offer(configured, file);
                        const held = yield* Ref.get(holdConfigure);
                        if (held) yield* Deferred.await(held);
                        configuring--;
                      }),
                    ItemQuery: ({ job }) =>
                      Effect.sync(() => {
                        events.push("query");
                        return { command: job.command };
                      }),
                    QueryAnswer: () =>
                      Stream.fromEffect(
                        Effect.sync(() => {
                          events.push(
                            configuring === 0
                              ? "answer"
                              : "answer during configure",
                          );
                        }),
                      ).pipe(Stream.drain),
                    NoteRefs: () => Stream.empty,
                    SourceIdentity: () =>
                      Effect.sync(() => {
                        events.push("identity");
                        return {
                          kind: "file" as const,
                          id: "source-b",
                          databasePath: "/library-b/zotero.sqlite",
                        };
                      }),
                    Refresh: () =>
                      Queue.offer(refreshed, undefined).pipe(Effect.asVoid),
                    Changes: () =>
                      Stream.fromEffect(Deferred.await(changesEnd)).pipe(
                        Stream.drain,
                      ),
                    Ping: () => Effect.void,
                  }),
                ),
              ),
            ),
          ),
        ),
      );
    }
    postMessage(data: unknown) {
      if (!this.listening) this.pending.push(data);
      else
        queueMicrotask(() =>
          this.endpoint.dispatchEvent(new MessageEvent("message", { data })),
        );
    }
    terminate() {}
  }
  vi.stubGlobal("Worker", StandInWorker);
  yield* Effect.addFinalizer(() => Effect.sync(() => vi.unstubAllGlobals()));
  const settings = yield* settingsOf({
    plugin: { loadData: async () => null, saveData: async () => undefined },
  });
  const device = packDevice(installed ? new Uint8Array() : null, "1.2.0");
  const pack = Context.get(
    yield* Layer.build(layerPackDevice(device)),
    ResourcePackPlatform,
  );
  const host = new MemoryWorkspace();
  const workspace = Context.get(
    yield* Layer.build(layerWorkspaceFrom(host)),
    Workspace,
  );
  return {
    spawned,
    configured,
    events,
    holdConfigure,
    changesEnd,
    initial,
    refreshed,
    settings,
    pack,
    device,
    host,
    workspace,
  };
});

it.effect("starts the worker with the loaded profile data directory", () =>
  Effect.gen(function* () {
    const worker = yield* workerFixture();
    const started = yield* Queue.unbounded<void>();
    const opening = yield* zoteroPrefFixture(() =>
      Queue.offer(started, undefined).pipe(
        Effect.andThen(Effect.sleep("1 second")),
        Effect.as(
          'user_pref("extensions.zotero.useDataDir", true);\nuser_pref("extensions.zotero.dataDir", "/research-data");',
        ),
      ),
    ).pipe(
      Effect.flatMap((f) =>
        workerClient().pipe(
          Effect.provideService(PluginSettings, worker.settings),
          Effect.provideService(ZoteroPref, f.pref),
          Effect.provideService(ResourcePackPlatform, worker.pack),
          Effect.provideService(ObsidianEnv, testObsidianEnv()),
          Effect.provideService(Workspace, worker.workspace),
          Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
        ),
      ),
      Effect.forkChild,
    );
    yield* Queue.take(started);
    yield* TestClock.adjust("1 second");
    (yield* Queue.take(worker.spawned)).launch();
    yield* Fiber.join(opening);
    expect(yield* Queue.take(worker.initial)).toMatchObject({
      databasePath: "/research-data/zotero.sqlite",
      deferOpen: true,
      chineseSegmenter: null,
    });
    worker.host.layoutReady();
    yield* Queue.take(worker.refreshed);
    yield* worker.settings.update({ "zotero.auto-refresh": false });
    expect((yield* Queue.take(worker.configured)).databasePath).toBe(
      "/research-data/zotero.sqlite",
    );
  }),
);

it.effect(
  "reconciles preferences changed during the worker connection wait",
  () =>
    Effect.gen(function* () {
      const worker = yield* workerFixture();
      const f = yield* zoteroPrefFixture();
      const opening = yield* workerClient().pipe(
        Effect.provideService(PluginSettings, worker.settings),
        Effect.provideService(ZoteroPref, f.pref),
        Effect.provideService(ResourcePackPlatform, worker.pack),
        Effect.provideService(ObsidianEnv, testObsidianEnv()),
        Effect.provideService(Workspace, worker.workspace),
        Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
        Effect.forkChild,
      );
      const spawned = yield* Queue.take(worker.spawned);
      yield* f.pref.setDataDir("/changed-during-connect");
      spawned.launch();
      yield* Fiber.join(opening);
      expect((yield* Queue.take(worker.configured)).databasePath).toBe(
        "/changed-during-connect/zotero.sqlite",
      );
    }),
);

it.effect(
  "sends the segmenter entry of the installed pack in the worker's first configuration",
  () =>
    Effect.gen(function* () {
      const worker = yield* workerFixture(true);
      const f = yield* zoteroPrefFixture();
      const opening = yield* workerClient().pipe(
        Effect.provideService(PluginSettings, worker.settings),
        Effect.provideService(ZoteroPref, f.pref),
        Effect.provideService(ResourcePackPlatform, worker.pack),
        Effect.provideService(ObsidianEnv, testObsidianEnv()),
        Effect.provideService(Workspace, worker.workspace),
        Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
        Effect.forkChild,
      );
      (yield* Queue.take(worker.spawned)).launch();
      yield* Fiber.join(opening);
      expect((yield* Queue.take(worker.initial)).chineseSegmenter).toEqual({
        url: "app://device/plugins/zotlit-resources/main.js",
        entry: "chinese-segmenter",
        version: "1.2.0",
      });
    }),
);

it.effect(
  "sends the worker the segmenter entry of a pack that Obsidian installs during the session",
  () =>
    Effect.gen(function* () {
      const worker = yield* workerFixture();
      const f = yield* zoteroPrefFixture();
      const opening = yield* workerClient().pipe(
        Effect.provideService(PluginSettings, worker.settings),
        Effect.provideService(ZoteroPref, f.pref),
        Effect.provideService(ResourcePackPlatform, worker.pack),
        Effect.provideService(ObsidianEnv, testObsidianEnv()),
        Effect.provideService(Workspace, worker.workspace),
        Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
        Effect.forkChild,
      );
      (yield* Queue.take(worker.spawned)).launch();
      yield* Fiber.join(opening);
      expect((yield* Queue.take(worker.initial)).chineseSegmenter).toBeNull();

      worker.device.install(
        yield* Effect.promise(() =>
          packFile({ "chinese-segmenter": EMPTY_MODULE }),
        ),
        "1.3.0",
      );
      worker.device.announce();

      expect((yield* Queue.take(worker.configured)).chineseSegmenter).toEqual({
        url: "app://device/plugins/zotlit-resources/main.js",
        entry: "chinese-segmenter",
        version: "1.3.0",
      });
    }),
);

it.live(
  "sends a query to the worker after the Configure of changed preferences that is still in flight",
  () =>
    Effect.gen(function* () {
      const worker = yield* workerFixture();
      const f = yield* zoteroPrefFixture();
      const opening = yield* workerClient().pipe(
        Effect.provideService(PluginSettings, worker.settings),
        Effect.provideService(ZoteroPref, f.pref),
        Effect.provideService(ResourcePackPlatform, worker.pack),
        Effect.provideService(ObsidianEnv, testObsidianEnv()),
        Effect.provideService(Workspace, worker.workspace),
        Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
        Effect.forkChild,
      );
      (yield* Queue.take(worker.spawned)).launch();
      const reads = yield* Fiber.join(opening);
      const held = yield* Deferred.make<void>();
      yield* Ref.set(worker.holdConfigure, held);
      yield* f.pref.setDataDir("/library-b");
      yield* Queue.take(worker.configured);
      const job: QueryTypedJob = {
        id: "q",
        command: "zotlit:query-schema",
        schema: false,
        customFields: true,
        vault: { name: "Research", path: "/vaults/research" },
        scope: MY_LIBRARY_SCOPE,
        attachmentPaths: { dataDir: "/library-b", baseAttachmentPath: null },
      };
      const asked = yield* Effect.forkChild(reads.ItemQuery({ job }), {
        startImmediately: true,
      });
      yield* Effect.sleep("50 millis");
      expect(worker.events).toEqual(["configure /library-b/zotero.sqlite"]);
      yield* Deferred.succeed(held, undefined);
      yield* Fiber.join(asked);
      expect(worker.events).toEqual([
        "configure /library-b/zotero.sqlite",
        "query",
      ]);
    }),
);

it.live(
  "opens the answer stream of a query after the Configure of changed preferences that is still in flight",
  () =>
    Effect.gen(function* () {
      const worker = yield* workerFixture();
      const f = yield* zoteroPrefFixture();
      const opening = yield* workerClient().pipe(
        Effect.provideService(PluginSettings, worker.settings),
        Effect.provideService(ZoteroPref, f.pref),
        Effect.provideService(ResourcePackPlatform, worker.pack),
        Effect.provideService(ObsidianEnv, testObsidianEnv()),
        Effect.provideService(Workspace, worker.workspace),
        Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
        Effect.forkChild,
      );
      (yield* Queue.take(worker.spawned)).launch();
      const reads = yield* Fiber.join(opening);
      const held = yield* Deferred.make<void>();
      yield* Ref.set(worker.holdConfigure, held);
      yield* f.pref.setDataDir("/library-b");
      yield* Queue.take(worker.configured);
      const job: QueryJob = {
        id: "q",
        command: "zotlit:query-schema",
        schema: true,
        pluginVersion: "2.2.0",
        vault: { name: "Research", path: "/vaults/research" },
        scope: MY_LIBRARY_SCOPE,
        attachmentPaths: { dataDir: "/library-b", baseAttachmentPath: null },
      };
      const asked = yield* Effect.forkChild(
        Stream.runDrain(reads.QueryAnswer({ job })),
        {
          startImmediately: true,
        },
      );
      yield* Stream.runDrain(reads.NoteRefs({ itemIDs: [] }));
      expect(worker.events).toEqual(["configure /library-b/zotero.sqlite"]);
      yield* Deferred.succeed(held, undefined);
      yield* Fiber.join(asked);
      expect(worker.events).toEqual([
        "configure /library-b/zotero.sqlite",
        "answer",
      ]);
    }),
);

it.live(
  "asks the worker for the source identity after the Configure of changed preferences that is still in flight",
  () =>
    Effect.gen(function* () {
      const worker = yield* workerFixture();
      const f = yield* zoteroPrefFixture();
      const opening = yield* workerClient().pipe(
        Effect.provideService(PluginSettings, worker.settings),
        Effect.provideService(ZoteroPref, f.pref),
        Effect.provideService(ResourcePackPlatform, worker.pack),
        Effect.provideService(ObsidianEnv, testObsidianEnv()),
        Effect.provideService(Workspace, worker.workspace),
        Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
        Effect.forkChild,
      );
      (yield* Queue.take(worker.spawned)).launch();
      const reads = yield* Fiber.join(opening);
      const held = yield* Deferred.make<void>();
      yield* Ref.set(worker.holdConfigure, held);
      yield* f.pref.setDataDir("/library-b");
      yield* Queue.take(worker.configured);
      const asked = yield* Effect.forkChild(reads.SourceIdentity({}), {
        startImmediately: true,
      });
      yield* Effect.sleep("50 millis");
      expect(worker.events).toEqual(["configure /library-b/zotero.sqlite"]);
      yield* Deferred.succeed(held, undefined);
      yield* Fiber.join(asked);
      expect(worker.events).toEqual([
        "configure /library-b/zotero.sqlite",
        "identity",
      ]);
    }),
);

it.live(
  "fails a query behind an in-flight Configure with DbUnavailable when the worker stops",
  () =>
    Effect.gen(function* () {
      const worker = yield* workerFixture();
      const f = yield* zoteroPrefFixture();
      const opening = yield* workerClient().pipe(
        Effect.provideService(PluginSettings, worker.settings),
        Effect.provideService(ZoteroPref, f.pref),
        Effect.provideService(ResourcePackPlatform, worker.pack),
        Effect.provideService(ObsidianEnv, testObsidianEnv()),
        Effect.provideService(Workspace, worker.workspace),
        Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
        Effect.forkChild,
      );
      (yield* Queue.take(worker.spawned)).launch();
      const reads = yield* Fiber.join(opening);
      yield* Ref.set(worker.holdConfigure, yield* Deferred.make<void>());
      yield* f.pref.setDataDir("/library-b");
      yield* Queue.take(worker.configured);
      const asked = yield* Effect.forkChild(reads.SourceIdentity({}), {
        startImmediately: true,
      });
      yield* Deferred.succeed(worker.changesEnd, undefined);
      const exit = yield* Fiber.await(asked).pipe(Effect.timeout("2 seconds"));
      expect(exit).toMatchObject({
        _tag: "Failure",
        cause: {
          reasons: [
            {
              error: {
                _tag: "DbUnavailable",
                message: "The database worker connection ended",
              },
            },
          ],
        },
      });
    }),
);
