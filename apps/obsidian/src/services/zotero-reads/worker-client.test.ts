import { it } from "@effect/vitest";
import {
  Context,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Queue,
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
  ChineseSegmenter,
  CHINESE_SEGMENTER,
  layerChineseSegmenter,
} from "@zotlit/plugin-services/obsidian/chinese-segmenter/service.ts";
import { layerPackDevice } from "@zotlit/plugin-services/obsidian/managed-binary/__fixtures__.ts";
import {
  packDevice,
  packFile,
} from "@zotlit/plugin-services/obsidian/managed-binary/test-utils.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import {
  WorkerInitSchema,
  ZoteroReads,
} from "@zotlit/zotero-reads/contract/rpc.ts";
import type { ReadsConfig } from "@zotlit/zotero-reads/contract/rpc.ts";
import { launchWorker } from "@zotlit/zotero-reads/worker/worker-launch.ts";

import { settingsOf } from "@/services/settings/__fixtures__.ts";

import { workerClient } from "./worker-client.ts";

vi.mock("virtual:zotero-reads-worker", () => ({ default: "" }));

/** A controlled browser process boundary with the real worker RPC protocol. */
const workerFixture = Effect.fn("workerFixture")(function* (installed = false) {
  const spawned = yield* Queue.unbounded<StandInWorker>();
  const configured = yield* Queue.unbounded<ReadsConfig>();
  const initial = yield* Queue.unbounded<
    ReadsConfig & { readonly deferOpen: boolean }
  >();
  const refreshed = yield* Queue.unbounded<void>();
  const run = Effect.runSyncWith(yield* Effect.context<never>());
  const group = RpcGroup.make(
    ...Array.from(ZoteroReads.requests.values()).filter(
      (rpc) =>
        rpc._tag === "Configure" ||
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
    start() {
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
                      Queue.offer(configured, config).pipe(Effect.asVoid),
                    Refresh: () =>
                      Queue.offer(refreshed, undefined).pipe(Effect.asVoid),
                    Changes: () => Stream.never,
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
  // The worker reads the pack itself: this thread opens no file at start.
  const device = packDevice(installed ? new Uint8Array() : null, "1.2.0");
  const chineseSegmenter = Context.get(
    yield* Layer.build(
      layerChineseSegmenter.pipe(Layer.provide(layerPackDevice(device))),
    ),
    ChineseSegmenter,
  );
  const host = new MemoryWorkspace();
  const workspace = Context.get(
    yield* Layer.build(layerWorkspaceFrom(host)),
    Workspace,
  );
  return {
    spawned,
    configured,
    initial,
    refreshed,
    settings,
    chineseSegmenter,
    device,
    host,
    workspace,
  };
});

// A delayed prefs.js must settle before the worker receives its first configuration.
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
          Effect.provideService(ChineseSegmenter, worker.chineseSegmenter),
          Effect.provideService(ObsidianEnv, testObsidianEnv()),
          Effect.provideService(Workspace, worker.workspace),
          Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
        ),
      ),
      Effect.forkChild,
    );
    yield* Queue.take(started);
    yield* TestClock.adjust("1 second");
    (yield* Queue.take(worker.spawned)).start();
    yield* Fiber.join(opening);
    expect(yield* Queue.take(worker.initial)).toMatchObject({
      databasePath: "/research-data/zotero.sqlite",
      deferOpen: true,
      // No Resource Pack is installed on this device.
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

// An override written during the connection wait must reach the worker.
it.effect(
  "reconciles preferences changed during the worker connection wait",
  () =>
    Effect.gen(function* () {
      const worker = yield* workerFixture();
      const f = yield* zoteroPrefFixture();
      const opening = yield* workerClient().pipe(
        Effect.provideService(PluginSettings, worker.settings),
        Effect.provideService(ZoteroPref, f.pref),
        Effect.provideService(ChineseSegmenter, worker.chineseSegmenter),
        Effect.provideService(ObsidianEnv, testObsidianEnv()),
        Effect.provideService(Workspace, worker.workspace),
        Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
        Effect.forkChild,
      );
      const spawned = yield* Queue.take(worker.spawned);
      yield* f.pref.setDataDir("/changed-during-connect");
      spawned.start();
      yield* Fiber.join(opening);
      expect((yield* Queue.take(worker.configured)).databasePath).toBe(
        "/changed-during-connect/zotero.sqlite",
      );
    }),
);

// The installed pack reaches the first worker configuration.
it.effect(
  "sends the segmenter entry of the installed pack in the worker's first configuration",
  () =>
    Effect.gen(function* () {
      const worker = yield* workerFixture(true);
      const f = yield* zoteroPrefFixture();
      const opening = yield* workerClient().pipe(
        Effect.provideService(PluginSettings, worker.settings),
        Effect.provideService(ZoteroPref, f.pref),
        Effect.provideService(ChineseSegmenter, worker.chineseSegmenter),
        Effect.provideService(ObsidianEnv, testObsidianEnv()),
        Effect.provideService(Workspace, worker.workspace),
        Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
        Effect.forkChild,
      );
      (yield* Queue.take(worker.spawned)).start();
      yield* Fiber.join(opening);
      expect((yield* Queue.take(worker.initial)).chineseSegmenter).toEqual({
        url: "app://device/plugins/zotlit-resources/main.js",
        entry: CHINESE_SEGMENTER.id,
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
        Effect.provideService(ChineseSegmenter, worker.chineseSegmenter),
        Effect.provideService(ObsidianEnv, testObsidianEnv()),
        Effect.provideService(Workspace, worker.workspace),
        Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
        Effect.forkChild,
      );
      (yield* Queue.take(worker.spawned)).start();
      yield* Fiber.join(opening);
      expect((yield* Queue.take(worker.initial)).chineseSegmenter).toBeNull();

      worker.device.install(
        yield* Effect.promise(() =>
          packFile({
            // The smallest module that compiles.
            [CHINESE_SEGMENTER.id]: new Uint8Array([
              0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
            ]),
          }),
        ),
        "1.3.0",
      );
      worker.device.announce();

      expect((yield* Queue.take(worker.configured)).chineseSegmenter).toEqual({
        url: "app://device/plugins/zotlit-resources/main.js",
        entry: CHINESE_SEGMENTER.id,
        version: "1.3.0",
      });
    }),
);
