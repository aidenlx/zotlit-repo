import {
  Context,
  Deferred,
  Effect,
  Layer,
  PubSub,
  Scope,
  Stream,
} from "effect";
import type { Duration } from "effect";
import { TExternalFile } from "obsidian";
import type { TFile } from "obsidian";

import type { AttachmentWithParentKey } from "@zotlit/db";
import { attachmentAbsPath, attachmentPathKey } from "@zotlit/db/path";
import type { AttachmentPathContext } from "@zotlit/db/path";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import type { OperatingSystem } from "@zotlit/shared/platform";
import { changed } from "@zotlit/zotero-reads/client/events.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { isPdfAttachment } from "#core/attachment-resolver/pdf-attachment.ts";
import { QueryClients } from "#core/query-client/service.ts";
import { resolvedChanged, ZoteroPref } from "#core/zotero-pref/service.ts";

export type AttachmentResolution =
  | {
      kind: "resolved";
      attachmentKey: string;
      serverID: string | null;
      itemKey: string | null;
      openable: boolean;
    }
  | { kind: "unresolved" }
  | { kind: "pending" };

export type AttachmentLookup =
  | (Extract<AttachmentResolution, { kind: "resolved" }> & {
      absolutePath: string;
    })
  | { kind: "unresolved" }
  | { kind: "pending" };

const UNRESOLVED = { kind: "unresolved" } as const;
const PENDING = { kind: "pending" } as const;

const PATH_INDEX_KEY = ["attachment-resolver", "path-index"] as const;

interface PathIndex {
  byPath: ReadonlyMap<string, AttachmentResolution>;
  byKey: ReadonlyMap<string, AttachedFile>;
}

export type AttachedFile = Extract<AttachmentLookup, { kind: "resolved" }> & {
  pathKey: string;
};

export class AttachmentResolver extends Context.Service<
  AttachmentResolver,
  {
    resolve(
      absolutePath: string,
      options?: { attachmentKey?: string | null },
    ): Effect.Effect<AttachmentResolution>;
    resolveFile(
      file: TFile,
      options?: { attachmentKey?: string | null; wait?: Duration.Input },
    ): Effect.Effect<AttachmentResolution>;
    lookup(
      attachmentKey: string,
      options?: { wait?: Duration.Input },
    ): Effect.Effect<AttachmentLookup>;
    readonly warm: Effect.Effect<void>;
    readonly indexed: Effect.Effect<void>;
    readonly resolutionsChanged: Stream.Stream<void>;
  }
>()("zotlit/attachment-resolver/AttachmentResolver") {}

export function filePathOf(
  file: TFile,
  fullPath: (path: string) => string | null,
): string | null {
  return file instanceof TExternalFile
    ? file.getRealPath()
    : fullPath(file.path);
}

export function indexedWithin(
  resolver: Pick<AttachmentResolver["Service"], "indexed">,
  wait: Duration.Input,
): Effect.Effect<boolean> {
  return resolver.indexed.pipe(
    Effect.as(true),
    Effect.timeoutOrElse({
      duration: wait,
      orElse: () => Effect.succeed(false),
    }),
  );
}

export function layerAttachmentResolver() {
  return Layer.effect(
    AttachmentResolver,
    Effect.gen(function* () {
      const reads = yield* ZoteroReads;
      const queries = yield* QueryClients;
      const zoteroPref = yield* ZoteroPref;
      const { os } = yield* ObsidianEnv;
      const vaultDisk = yield* VaultDisk;
      const scope = yield* Scope.Scope;
      const { runPromise } = yield* scopedBridge;
      const indexed = yield* Deferred.make<void>();
      const announcements = yield* PubSub.unbounded<void>();

      const readIndex = Effect.scoped(
        Effect.gen(function* () {
          const snapshot = yield* reads.snapshot;
          const { serverID } = yield* snapshot.DatabaseIdentity({});
          const slices = yield* Stream.runCollect(
            snapshot.AttachmentPathIndex({}),
          );
          const { dataDir, baseAttachmentPath } = yield* zoteroPref.current;
          const { index, files, collisions } = buildPathIndex(slices.flat(), {
            dataDir,
            baseAttachmentPath,
            platform: os,
            serverID,
          });
          if (collisions.length > 0) {
            yield* Effect.logWarning(
              "Several Zotero attachments name one file",
            ).pipe(Effect.annotateLogs({ collisions }));
          }
          yield* Effect.logDebug("Attachment path index built").pipe(
            Effect.annotateLogs({
              paths: index.size,
              collisions: collisions.length,
            }),
          );
          return { byPath: index, byKey: files } satisfies PathIndex;
        }),
      ).pipe(withLogCategory("attachment-resolver"));

      const build = queries
        .ask<PathIndex>(PATH_INDEX_KEY, ({ signal }) =>
          runPromise(readIndex, { signal }),
        )
        .pipe(Effect.asVoid);

      const held = Effect.gen(function* () {
        const current = yield* queries.peek<PathIndex>(PATH_INDEX_KEY);
        if (current === null || current.status === "failed")
          yield* Effect.forkIn(build, scope, { startImmediately: true });
        return current?.value;
      });

      const rebuild = Effect.fn("AttachmentResolver.rebuild")(function* (
        reason: string,
      ) {
        if (queries.client.getQueryState(PATH_INDEX_KEY) === undefined) return;
        yield* Effect.logDebug("Attachment path index stale").pipe(
          Effect.annotateLogs({ reason }),
        );
        yield* queries.invalidate(PATH_INDEX_KEY);
        yield* Effect.forkIn(build, scope, { startImmediately: true });
      });

      queries.client.setQueryDefaults(PATH_INDEX_KEY, { gcTime: Infinity });
      yield* forkEach(queries.changes, (change) => {
        if (
          !change.changed ||
          change.key.length !== PATH_INDEX_KEY.length ||
          change.key[0] !== PATH_INDEX_KEY[0] ||
          change.key[1] !== PATH_INDEX_KEY[1]
        )
          return;
        return Effect.andThen(
          Deferred.succeed(indexed, undefined),
          PubSub.publish(announcements, undefined),
        );
      });
      yield* forkEach(changed(reads), () => rebuild("database changed"));
      yield* forkEach(resolvedChanged(zoteroPref), () =>
        rebuild("Zotero paths changed"),
      );
      yield* Effect.addFinalizer(() => PubSub.shutdown(announcements));

      const resolve = Effect.fn("AttachmentResolver.resolve")(function* (
        absolutePath: string,
        { attachmentKey }: { attachmentKey?: string | null } = {},
      ) {
        const index = yield* held;
        if (index === undefined) return PENDING;
        const pathKey = attachmentPathKey(absolutePath, os);
        const named =
          attachmentKey == null ? undefined : index.byKey.get(attachmentKey);
        if (named !== undefined && named.pathKey === pathKey)
          return resolutionOf(named);
        return index.byPath.get(pathKey) ?? UNRESOLVED;
      });
      const awaitIndexed = Deferred.await(indexed);
      const lookup = Effect.fnUntraced(function* (attachmentKey: string) {
        const index = yield* held;
        if (index === undefined) return PENDING;
        const named = index.byKey.get(attachmentKey);
        if (named === undefined) return UNRESOLVED;
        const { pathKey: _pathKey, ...found } = named;
        return found satisfies AttachmentLookup;
      });

      return AttachmentResolver.of({
        resolve,
        resolveFile: Effect.fn("AttachmentResolver.resolveFile")(function* (
          file: TFile,
          {
            attachmentKey = null,
            wait,
          }: { attachmentKey?: string | null; wait?: Duration.Input } = {},
        ) {
          const vaultPath = yield* vaultDisk.fullPath(file.path);
          const absolutePath = filePathOf(file, () => vaultPath);
          if (absolutePath === null) return UNRESOLVED;
          const now = yield* resolve(absolutePath, { attachmentKey });
          if (now.kind !== "pending" || wait === undefined) return now;
          const settled = yield* indexedWithin({ indexed: awaitIndexed }, wait);
          return settled
            ? yield* resolve(absolutePath, { attachmentKey })
            : now;
        }),
        lookup: Effect.fn("AttachmentResolver.lookup")(function* (
          attachmentKey: string,
          { wait }: { wait?: Duration.Input } = {},
        ) {
          const now = yield* lookup(attachmentKey);
          if (now.kind !== "pending" || wait === undefined) return now;
          const settled = yield* indexedWithin({ indexed: awaitIndexed }, wait);
          return settled ? yield* lookup(attachmentKey) : now;
        }),
        warm: held.pipe(
          Effect.asVoid,
          Effect.withSpan("AttachmentResolver.warm"),
        ),
        indexed: awaitIndexed.pipe(
          Effect.withSpan("AttachmentResolver.indexed"),
        ),
        resolutionsChanged: Stream.fromPubSub(announcements),
      });
    }).pipe(withLogCategory("attachment-resolver")),
  );
}

export interface PathIndexContext extends AttachmentPathContext {
  platform: OperatingSystem;
  serverID?: string | null;
}

export type PathCollision = {
  pathKey: string;
  chosen: string;
  discarded: string[];
};

export function buildPathIndex(
  attachments: readonly AttachmentWithParentKey[],
  { platform, serverID = null, ...pathContext }: PathIndexContext,
): {
  index: ReadonlyMap<string, AttachmentResolution>;
  files: ReadonlyMap<string, AttachedFile>;
  collisions: PathCollision[];
} {
  const located = attachments.flatMap((attachment) => {
    const absolutePath = attachmentAbsPath(attachment, pathContext);
    return absolutePath === null
      ? []
      : {
          attachment,
          absolutePath,
          pathKey: attachmentPathKey(absolutePath, platform),
        };
  });

  const files = new Map<string, AttachedFile>(
    located.map(({ attachment, absolutePath, pathKey }) => [
      attachment.indexedKey,
      {
        kind: "resolved",
        attachmentKey: attachment.indexedKey,
        serverID,
        itemKey: attachment.parentIndexedKey,
        openable: isPdfAttachment(attachment.contentType, absolutePath),
        absolutePath,
        pathKey,
      },
    ]),
  );
  const index = new Map<string, AttachmentResolution>();
  const collisions: PathCollision[] = [];
  for (const [pathKey, entries] of Map.groupBy(located, (e) => e.pathKey)) {
    const ranked = entries.toSorted((a, b) =>
      byPreference(a.attachment, b.attachment),
    );
    const chosen = ranked[0]!.attachment;
    index.set(pathKey, resolutionOf(files.get(chosen.indexedKey)!));
    if (ranked.length > 1) {
      collisions.push({
        pathKey,
        chosen: chosen.indexedKey,
        discarded: ranked.slice(1).map((entry) => entry.attachment.indexedKey),
      });
    }
  }
  return { index, files, collisions };
}

function resolutionOf({
  absolutePath: _absolutePath,
  pathKey: _pathKey,
  ...resolution
}: AttachedFile): AttachmentResolution {
  return resolution;
}

function byPreference(
  a: AttachmentWithParentKey,
  b: AttachmentWithParentKey,
): number {
  return (
    Number(a.groupID !== null) - Number(b.groupID !== null) ||
    a.itemID - b.itemID
  );
}
