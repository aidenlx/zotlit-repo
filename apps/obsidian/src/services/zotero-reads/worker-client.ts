// Worker configuration follows the native dependency streams on the layer Scope.
import { Effect, FileSystem, Ref, Stream } from "effect";
import workerSource from "virtual:zotero-reads-worker";

import { sameSegmenterBinary } from "@zotlit/item-lookup";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import type { ZoteroReadMode } from "@zotlit/plugin-services/core/database/settings.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { segmenterBinaryOf } from "@zotlit/plugin-services/obsidian/chinese-segmenter/service.ts";
import { ResourcePackPlatform } from "@zotlit/plugin-services/obsidian/managed-binary/pack-platform.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import {
  connectWorker,
  makeWorkerReads,
} from "@zotlit/zotero-reads/client/worker-host.ts";
import type { ReadsConfig } from "@zotlit/zotero-reads/contract/rpc.ts";
import {
  reapReadClones,
  reapWorkerSnapshots,
} from "@zotlit/zotero-reads/desktop/reap-temps.ts";

/** Compile-time assert: `T` must be `true`. */
type Expect<T extends true> = T;
type Equals<A, B> = [A, B] extends [B, A] ? true : false;
/** The settings feed the source settings unchanged. */
type _ReadMode = Expect<Equals<ReadsConfig["readMode"], ZoteroReadMode>>;
type _LogLevel = Expect<Equals<ReadsConfig["logLevel"], Settings["log.level"]>>;

const sameConfig = (a: ReadsConfig, b: ReadsConfig) =>
  a.databasePath === b.databasePath &&
  a.readMode === b.readMode &&
  a.autoRefresh === b.autoRefresh &&
  a.locale === b.locale &&
  sameSegmenterBinary(a.chineseSegmenter, b.chineseSegmenter) &&
  a.logLevel === b.logLevel;

export const workerClient = Effect.fn("ZoteroReads.workerClient")(function* () {
  const settings = yield* PluginSettings;
  const pref = yield* ZoteroPref;
  const pack = yield* ResourcePackPlatform;
  const { language } = yield* ObsidianEnv;
  const workspace = yield* Workspace;
  // `makeWorkerReads` takes a connect step with no requirement but its Scope
  // and reruns it on every respawn, so the step carries the file system its
  // dead-worker reap reads.
  const fs = yield* FileSystem.FileSystem;
  // Clear the read clones of crashed runs from the system temp folder once a
  // launch. Forked on the layer's Scope: the launch never waits on it, and
  // unload interrupts it.
  yield* reapReadClones().pipe(Effect.forkScoped);
  const configuration = Effect.gen(function* () {
    const current = yield* settings.current;
    return {
      databasePath: (yield* pref.current).databasePath,
      readMode: current["zotero.read-mode"],
      autoRefresh: current["zotero.auto-refresh"],
      locale: language,
      // The worker reads and verifies the entry itself, so the pack reaches
      // it unread: this thread pays nothing for the binary at start-up.
      chineseSegmenter: yield* segmenterBinaryOf(pack),
      logLevel: current["log.level"],
    } satisfies ReadsConfig;
  });
  const config = yield* Ref.make(yield* configuration);
  const opening = yield* Ref.make<"waiting" | "held" | "ready">("waiting");
  const reads = yield* makeWorkerReads(
    connectWorker(workerSource, Ref.get(config), {
      reapSnapshots: reapWorkerSnapshots,
      deferOpen: Ref.modify(opening, (state) =>
        state === "ready" ? [false, state] : [true, "held" as const],
      ),
    }).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
  );
  yield* workspace.layoutReady.pipe(
    Effect.andThen(Ref.getAndSet(opening, "ready")),
    Effect.flatMap((before) =>
      before === "held" ? Effect.ignore(reads.Refresh()) : Effect.void,
    ),
    Effect.forkScoped({ startImmediately: true }),
  );
  const push = Effect.fn("ZoteroReads.configure")(function* () {
    const next = yield* configuration;
    const changed = yield* Ref.modify(config, (current) =>
      sameConfig(next, current) ? [false, current] : [true, next],
    );
    if (!changed) return;
    yield* Effect.ignore(reads.Configure(next));
  });
  yield* Stream.mergeAll(
    [
      Stream.as(settings.changes, undefined),
      Stream.as(pref.changes, undefined),
      pack.changes,
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Stream.runForEach(() => push()),
    Effect.forkScoped({ startImmediately: true }),
  );
  // Reconcile while acquisition was waiting for the worker handshake.
  yield* push();
  return reads;
});
