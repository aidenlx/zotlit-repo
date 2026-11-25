import type { ZoteroPrefSnapshot } from "#core/zotero-pref/service.ts";
import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";

import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import {
  inProcessClient,
  memoryOpener,
} from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import {
  layerZoteroReads,
  ZoteroReads,
} from "@zotlit/zotero-reads/client/service.ts";
import { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";
import { layerRcRef } from "@zotlit/zotero-reads/worker/connection.ts";

import { AttachmentResolver, layerAttachmentResolver } from "./service.ts";

import { layerQueryClients, QueryClients } from "#core/query-client/service.ts";
import { ZoteroPref } from "#core/zotero-pref/service.ts";

export const DATA_DIR = "/fixture/zotero-data";
export const VAULT_DIR = "/fixture/zt-fixture-vault";

export const nextAnnouncement = (
  resolver: Pick<AttachmentResolver["Service"], "resolutionsChanged">,
) =>
  Stream.runHead(resolver.resolutionsChanged).pipe(
    Effect.asVoid,
    Effect.forkScoped({ startImmediately: true }),
  );

export interface ResolverHarnessOptions {
  platform?: NodeJS.Platform;
  baseAttachmentPath?: string | null;
  seeds?: (string | null)[];
  rows?: string;
  prime?: boolean;
  vaultDir?: string;
}

function prefSnapshot(
  dataDir: string,
  baseAttachmentPath: string | null,
): ZoteroPrefSnapshot {
  return {
    state: "ready",
    prefs: new Map(),
    resolvedProfileDir: null,
    profileDirOverride: null,
    dataDirOverride: null,
    dataDir,
    databasePath: `${dataDir}/zotero.sqlite`,
    sourceId: null,
    acceptedSourceIds: [],
    baseAttachmentPath,
    httpPort: null,
  };
}

export async function openResolver(
  options: ResolverHarnessOptions,
  context: Context.Context<never> = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  const seeds = options.seeds ?? [options.rows ?? null];
  const { open } = memoryOpener((n) => seeds[n - 1] ?? null);
  let held: PromiseWithResolvers<void> | null = null;
  let reached: PromiseWithResolvers<void> | null = null;
  let failing = false;
  let failures = 0;
  const client = Effect.map(inProcessClient(layerRcRef(open)), (client) => ({
    ...client,
    AttachmentPathIndex: ((
      ...args: Parameters<typeof client.AttachmentPathIndex>
    ) =>
      Stream.unwrap(
        Effect.promise(async () => {
          if (held !== null) {
            reached?.resolve();
            await held.promise;
          }
          if (failing) {
            failures += 1;
            return Stream.fail(
              new DbUnavailable({ message: "the read failed" }),
            );
          }
          return client.AttachmentPathIndex(...args) as Stream.Stream<
            unknown,
            unknown
          >;
        }),
      )) as typeof client.AttachmentPathIndex,
  }));
  const baseAttachmentPath = options.baseAttachmentPath ?? null;
  const paths = Effect.runSync(
    SubscriptionRef.make(prefSnapshot(DATA_DIR, baseAttachmentPath)),
  );

  const runtime = buildRuntime(
    layerAttachmentResolver({ platform: options.platform ?? "linux" }).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          layerQueryClients,
          layerZoteroReads(client),
          Layer.mock(ZoteroPref, {
            current: SubscriptionRef.get(paths),
            changes: SubscriptionRef.changes(paths),
          }),
          Layer.mock(Vault, {
            fullPath: (path) =>
              Effect.succeed(`${options.vaultDir ?? VAULT_DIR}/${path}`),
          }),
        ),
      ),
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  await runtime.context();
  const service = runtime.runSync(AttachmentResolver);
  const reads = runtime.runSync(ZoteroReads);
  const queries = runtime.runSync(QueryClients);
  await runtime.runPromise(
    Stream.runHead(
      reads.changes.pipe(Stream.filter(({ state }) => state !== "loading")),
    ),
  );
  if (options.prime ?? true)
    await runtime.runPromise(Effect.andThen(service.warm, service.indexed));
  const owned = stack.move();
  return {
    runtime,
    service,
    bridge: effectBridge(runtime),
    reads,
    queries,
    moveDataDir: (dataDir: string) =>
      SubscriptionRef.set(paths, prefSnapshot(dataDir, baseAttachmentPath)),
    failReads: (on: boolean) => {
      failing = on;
    },
    get failures() {
      return failures;
    },
    gate: () => {
      held = Promise.withResolvers<void>();
      reached = Promise.withResolvers<void>();
      const gated = held;
      return {
        waiting: reached.promise,
        release: () => gated.resolve(),
      };
    },
    close: () => owned.disposeAsync(),
  };
}

export const resolverFixture = Effect.fnUntraced(function* (
  options: ResolverHarnessOptions,
) {
  const context = yield* Effect.context<never>();
  return yield* Effect.acquireRelease(
    Effect.promise(() => openResolver(options, context)),
    (harness) => Effect.promise(() => harness.close()),
  );
});
