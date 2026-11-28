import { Effect, FileSystem, Ref, Semaphore, Stream } from "effect";
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
import type {
  FileReadsConfig,
  ZoteroReadsClient,
} from "@zotlit/zotero-reads/contract/rpc.ts";
import {
  reapReadClones,
  reapWorkerSnapshots,
} from "@zotlit/zotero-reads/desktop/reap-temps.ts";

type Expect<T extends true> = T;
type Equals<A, B> = [A, B] extends [B, A] ? true : false;
type _ReadMode = Expect<Equals<FileReadsConfig["readMode"], ZoteroReadMode>>;
type _LogLevel = Expect<
  Equals<FileReadsConfig["logLevel"], Settings["log.level"]>
>;

const sourceOf = ({
  databasePath,
  sourceId,
}: {
  readonly databasePath: string;
  readonly sourceId: string | null;
}) => ({ databasePath, sourceId });

const sameConfig = (a: FileReadsConfig, b: FileReadsConfig) =>
  a.databasePath === b.databasePath &&
  a.sourceId === b.sourceId &&
  a.readMode === b.readMode &&
  a.autoRefresh === b.autoRefresh &&
  a.locale === b.locale &&
  sameSegmenterBinary(a.chineseSegmenter, b.chineseSegmenter) &&
  a.logLevel === b.logLevel;

const makeConfigurePush = (
  config: Ref.Ref<FileReadsConfig>,
  configuration: Effect.Effect<FileReadsConfig>,
  send: (next: FileReadsConfig) => Effect.Effect<void>,
): Effect.Effect<{
  readonly push: Effect.Effect<void>;
  readonly delivered: Effect.Effect<void>;
}> =>
  Effect.map(Semaphore.make(1), (turn) => ({
    push: turn.withPermits(1)(
      Effect.gen(function* () {
        const next = yield* configuration;
        const changed = yield* Ref.modify(config, (current) =>
          sameConfig(next, current) ? [false, current] : [true, next],
        );
        if (changed) yield* send(next);
      }),
    ),
    delivered: turn.withPermits(1)(Effect.void),
  }));

const queriesAfterConfigure = (
  reads: ZoteroReadsClient,
  delivered: Effect.Effect<void>,
): ZoteroReadsClient => ({
  ...reads,
  ItemQuery: (payload, options) =>
    Effect.andThen(delivered, reads.ItemQuery(payload, options)),
  QueryAnswer: ((
    payload: Parameters<ZoteroReadsClient["QueryAnswer"]>[0],
    options?: Parameters<ZoteroReadsClient["QueryAnswer"]>[1],
  ) =>
    options?.asQueue
      ? Effect.andThen(
          delivered,
          reads.QueryAnswer(payload, { ...options, asQueue: true }),
        )
      : Stream.unwrap(
          Effect.as(
            delivered,
            reads.QueryAnswer(payload, { ...options, asQueue: false }),
          ),
        )) as ZoteroReadsClient["QueryAnswer"],
  SourceIdentity: (payload, options) =>
    Effect.andThen(delivered, reads.SourceIdentity(payload, options)),
});

export const workerClient = Effect.fn("ZoteroReads.workerClient")(function* () {
  const settings = yield* PluginSettings;
  const pref = yield* ZoteroPref;
  const pack = yield* ResourcePackPlatform;
  const { language } = yield* ObsidianEnv;
  const workspace = yield* Workspace;
  const fs = yield* FileSystem.FileSystem;
  yield* reapReadClones().pipe(Effect.forkScoped);
  const configuration = Effect.gen(function* () {
    const current = yield* settings.current;
    return {
      ...sourceOf(yield* pref.current),
      readMode: current["zotero.read-mode"],
      autoRefresh: current["zotero.auto-refresh"],
      locale: language,
      chineseSegmenter: yield* segmenterBinaryOf(pack),
      logLevel: current["log.level"],
    } satisfies FileReadsConfig;
  });
  const config = yield* Ref.make<FileReadsConfig>(yield* configuration);
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
  const { push, delivered } = yield* makeConfigurePush(
    config,
    configuration,
    (next) => Effect.ignore(reads.Configure(next)),
  );
  yield* Stream.mergeAll(
    [
      Stream.as(settings.changes, undefined),
      Stream.as(pref.changes, undefined),
      pack.changes,
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Stream.runForEach(() => push),
    Effect.forkScoped({ startImmediately: true }),
  );
  yield* push;
  return queriesAfterConfigure(reads, delivered);
});
