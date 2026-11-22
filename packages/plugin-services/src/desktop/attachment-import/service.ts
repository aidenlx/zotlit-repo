import type {} from "#core/attachment-import/settings.ts";
import {
  Context,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  PubSub,
  Queue,
  Ref,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect";
import type { PlatformError } from "effect";
import {
  dirname as sourceDirname,
  isAbsolute,
  join,
  relative,
  sep,
} from "node:path";
import { dirname as noteDirname } from "node:path/posix";
import { normalizePath } from "obsidian";

import type { TemplateLink } from "@zotlit/db";
import {
  fileUrlLink,
  syntheticFile,
} from "@zotlit/obsidian-desktop/markdown-link.ts";
import { attachmentFolderPath } from "@zotlit/obsidian-kit/attachment-folder.ts";
import {
  joinFolderPath,
  normalizeFolderPath,
} from "@zotlit/obsidian-kit/ensure-folder.ts";
import { DeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import type { DeviceStorageError } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import {
  FileManager,
  markdownLinker,
} from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { ensureVaultFolder } from "@zotlit/obsidian-kit/vault-folder.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import type {
  VaultError,
  VaultFolderBlockedError,
} from "@zotlit/plugin-kernel/vault-errors.ts";
import { normalizeFilename } from "@zotlit/templates";

import { copyAttachments } from "./copy-attachments.ts";
import type {
  AttachmentCopyItem,
  AttachmentCopyResult,
} from "./copy-attachments.ts";
import {
  buildCanonicalRoots,
  canonicalize,
  confirmSource,
  decideSource,
  NO_ROOTS,
} from "./source.ts";
import type {
  AttachmentSource,
  BlockedSource,
  CanonicalRoots,
  SourceOrigin,
} from "./source.ts";

import { resolvedChanged, ZoteroPref } from "#core/zotero-pref/service.ts";
import {
  loadApprovedFolders,
  saveApprovedFolders,
} from "#obsidian/attachment-import/approved-folders.ts";
import { PluginSettings } from "#obsidian/settings/service.ts";

export {
  type AttachmentSource,
  type BlockedSource,
  type CanonicalRoots,
  type SourceBlock,
  type SourceOrigin,
} from "./source.ts";

const logged = withLogCategory("attachment-import");

const SKIP_SUMMARY_DEBOUNCE = Duration.millis(1500);

export interface AttachmentSkipCounts {
  blocked: number;
  refused: number;
}

export interface AttachmentSkipSummary extends AttachmentSkipCounts {
  blockedFolders: readonly string[];
}

export interface ResolveLinkOptions {
  source: AttachmentSource;
  vaultName: string;
}

export interface AttachmentImportResult
  extends AttachmentCopyResult, AttachmentSkipCounts {}

export class AttachmentCopyError extends Schema.TaggedError<
  AttachmentCopyError,
  { readonly brand: unique symbol }
>()("AttachmentCopyError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export type AttachmentFlushError =
  | PlatformError.PlatformError
  | VaultFolderBlockedError
  | AttachmentCopyError
  | VaultError;

export interface AttachmentImportBatch {
  decide(path: string, origin: SourceOrigin): AttachmentSource;
  resolveLink(opts: ResolveLinkOptions): TemplateLink;
  readonly flush: Effect.Effect<AttachmentImportResult, AttachmentFlushError>;
  readonly discard: Effect.Effect<void>;
}

export interface PrepareOptions {
  folderCache?: Map<string, string>;
}

export class AttachmentImport extends Context.Service<
  AttachmentImport,
  {
    readonly approvedFolders: Effect.Effect<readonly string[]>;
    readonly approvedFoldersChanges: Stream.Stream<readonly string[]>;
    readonly rootsChanges: Stream.Stream<CanonicalRoots>;
    approveFolder(
      folder: string,
    ): Effect.Effect<string | null, DeviceStorageError>;
    revokeFolder(folder: string): Effect.Effect<void, DeviceStorageError>;
    readonly skipped: Stream.Stream<AttachmentSkipSummary>;
    prepare(
      notePath: string,
      options?: PrepareOptions,
    ): Effect.Effect<AttachmentImportBatch, VaultError>;
  }
>()("zotlit/attachment-import/AttachmentImport") {}

export type AttachmentImportServices =
  | PluginSettings
  | ZoteroPref
  | FileManager
  | Vault
  | ObsidianEnv
  | DeviceStorage
  | FileSystem.FileSystem;

interface PendingCopy {
  path: string;
  origin: SourceOrigin;
  root: string;
  dest: string;
}

const NO_SKIPS: AttachmentSkipSummary = {
  blocked: 0,
  refused: 0,
  blockedFolders: [],
};

export const layerAttachmentImport = (
  options: { readonly platform?: NodeJS.Platform } = {},
): Layer.Layer<AttachmentImport, never, AttachmentImportServices> =>
  Layer.effect(
    AttachmentImport,
    Effect.gen(function* () {
      const platform = options.platform ?? process.platform;
      const settings = yield* PluginSettings;
      const pref = yield* ZoteroPref;
      const fileManager = yield* FileManager;
      const vault = yield* Vault;
      const { basePath } = yield* ObsidianEnv;
      const fs = yield* FileSystem.FileSystem;
      const storage = yield* DeviceStorage;
      const save = (folders: readonly string[]) =>
        saveApprovedFolders(folders).pipe(
          Effect.provideService(DeviceStorage, storage),
        );
      const link = yield* markdownLinker;

      const approved = yield* SubscriptionRef.make<readonly string[]>(
        yield* Effect.orDie(loadApprovedFolders),
      );
      const roots = yield* SubscriptionRef.make<CanonicalRoots>(NO_ROOTS);
      const rebuildRoots = SubscriptionRef.updateEffect(roots, () =>
        Effect.gen(function* () {
          const { dataDir, baseAttachmentPath } = yield* pref.current;
          return yield* buildCanonicalRoots(
            {
              dataDir,
              baseAttachmentPath,
              approvedFolders: yield* SubscriptionRef.get(approved),
            },
            platform,
          );
        }),
      );

      const pending = yield* Ref.make(NO_SKIPS);
      const nudges = yield* Queue.unbounded<void>();
      const skipped = yield* PubSub.unbounded<AttachmentSkipSummary>();
      yield* Effect.addFinalizer(() =>
        Effect.all([
          PubSub.shutdown(approved.pubsub),
          PubSub.shutdown(roots.pubsub),
          PubSub.shutdown(skipped),
        ]),
      );
      yield* forkEach(
        Stream.fromQueue(nudges).pipe(Stream.debounce(SKIP_SUMMARY_DEBOUNCE)),
        () =>
          Effect.gen(function* () {
            const summary = yield* Ref.getAndSet(pending, NO_SKIPS);
            if (summary.blocked === 0 && summary.refused === 0) return;
            yield* PubSub.publish(skipped, summary);
          }),
      );
      const reportSkips = (summary: AttachmentSkipSummary) =>
        summary.blocked === 0 && summary.refused === 0
          ? Effect.void
          : Ref.update(pending, (before) => ({
              blocked: before.blocked + summary.blocked,
              refused: before.refused + summary.refused,
              blockedFolders: [
                ...new Set([
                  ...before.blockedFolders,
                  ...summary.blockedFolders,
                ]),
              ],
            })).pipe(Effect.andThen(Queue.offer(nudges, undefined)));

      yield* forkEach(
        Stream.merge(
          settings.changes.pipe(
            Stream.filter((value) => value["attachment.import"]),
          ),
          resolvedChanged(pref),
        ),
        () => rebuildRoots,
      );
      yield* rebuildRoots;

      const makeBatch = (input: {
        readonly notePath: string;
        readonly folderPath: string | null;
        readonly importEnabled: boolean;
      }): AttachmentImportBatch => {
        const { notePath, importEnabled } = input;
        const folderPath = normalizeFolderPath(input.folderPath);
        const rootsNow = importEnabled
          ? SubscriptionRef.get(roots)
          : Effect.succeed(NO_ROOTS);
        const items: PendingCopy[] = [];
        let blocked = 0;
        const blockedFolders = new Set<string>();
        const blockedLogs: Pick<BlockedSource, "origin" | "reason">[] = [];

        const blockedLink = (
          source: BlockedSource,
          vaultName: string,
        ): TemplateLink => {
          const link = fileUrlLink(source.path, vaultName);
          if (!importEnabled) return link;
          let counted = false;
          return (alias, subpath) => {
            if (!counted) {
              counted = true;
              blocked += 1;
              if (source.origin === "linked-absolute") {
                blockedFolders.add(sourceDirname(source.path));
              }
              blockedLogs.push({
                origin: source.origin,
                reason: source.reason,
              });
            }
            return link(alias, subpath);
          };
        };

        const confirmQueue = Effect.fnUntraced(function* (
          queued: readonly PendingCopy[],
        ) {
          const confirmed: AttachmentCopyItem[] = [];
          let refused = 0;
          let missing = 0;
          for (const item of queued) {
            const { caseInsensitive } = yield* rootsNow;
            const outcome = yield* confirmSource(
              { path: item.path, root: item.root, origin: item.origin },
              caseInsensitive,
            );
            switch (outcome.status) {
              case "confirmed":
                confirmed.push({ source: outcome.source, dest: item.dest });
                break;
              case "missing":
                missing += 1;
                yield* Effect.logWarning(
                  "Skipped attachment with missing source",
                ).pipe(Effect.annotateLogs({ origin: item.origin }));
                break;
              case "refused":
                refused += 1;
                yield* Effect.logWarning("Refused attachment source").pipe(
                  Effect.annotateLogs({
                    origin: item.origin,
                    reason: outcome.reason,
                  }),
                );
                break;
            }
          }
          return { confirmed, refused, missing };
        });

        return {
          decide: (path, origin) =>
            decideSource(
              path,
              origin,
              importEnabled ? SubscriptionRef.getUnsafe(roots) : NO_ROOTS,
            ),
          resolveLink: ({ source, vaultName }) => {
            if (!source.approved) return blockedLink(source, vaultName);
            const sourcePath = source.path;
            if (!importEnabled || folderPath === null) {
              return fileUrlLink(sourcePath, vaultName);
            }
            const safeName = normalizeFilename(vaultName);
            const vaultPath = normalizePath(
              joinFolderPath(folderPath, safeName),
            );
            const file = syntheticFile(vaultPath);
            let queued = false;
            return (alias, subpath) => {
              if (!queued) {
                queued = true;
                items.push({
                  path: sourcePath,
                  origin: source.origin,
                  root: source.root,
                  dest: absoluteVaultPath(basePath, vaultPath, folderPath),
                });
              }
              return link(file, notePath, {
                ...(subpath === undefined ? {} : { subpath }),
                ...(alias === undefined ? {} : { alias }),
              });
            };
          },
          flush: Effect.gen(function* () {
            const queued = items.splice(0);
            for (const { origin, reason } of blockedLogs.splice(0)) {
              yield* Effect.logWarning("Blocked attachment source").pipe(
                Effect.annotateLogs({ origin, reason }),
                logged,
              );
            }
            const { copied, refused, missing } = yield* Effect.scoped(
              Effect.gen(function* () {
                const confirmation = yield* confirmQueue(queued);
                if (confirmation.confirmed.length > 0 && folderPath) {
                  yield* ensureVaultFolder(folderPath).pipe(
                    Effect.provideService(Vault, vault),
                  );
                }
                const copies = yield* copyAttachments(
                  confirmation.confirmed,
                ).pipe(
                  Effect.mapError(
                    (cause) =>
                      new AttachmentCopyError({
                        message: cause.message,
                        cause,
                      }),
                  ),
                );
                return { ...confirmation, copied: copies };
              }),
            );
            const skips: AttachmentSkipCounts = { blocked, refused };
            blocked = 0;
            const folders = [...blockedFolders];
            blockedFolders.clear();
            yield* reportSkips({ ...skips, blockedFolders: folders });

            const result: AttachmentImportResult = {
              ...copied,
              missing: copied.missing + missing,
              ...skips,
            };
            yield* Effect.logDebug("Imported attachments").pipe(
              Effect.annotateLogs({ ...result }),
            );
            return result;
          }).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            logged,
            Effect.withSpan("AttachmentImport.flush"),
          ),
          discard: Effect.gen(function* () {
            const dropped = items.splice(0).length;
            if (dropped > 0) {
              yield* Effect.logDebug(
                "Discarded queued attachment imports",
              ).pipe(Effect.annotateLogs({ dropped }), logged);
            }
          }).pipe(Effect.withSpan("AttachmentImport.discard")),
        };
      };

      return AttachmentImport.of({
        approvedFolders: SubscriptionRef.get(approved),
        approvedFoldersChanges: SubscriptionRef.changes(approved),
        rootsChanges: SubscriptionRef.changes(roots),
        approveFolder: Effect.fn("AttachmentImport.approveFolder")(
          function* (folder) {
            const canonical = yield* canonicalize(folder).pipe(
              Effect.catchTag("PlatformError", (error) =>
                Effect.logWarning(
                  "Ignored an approved folder that cannot be read",
                ).pipe(
                  Effect.annotateLogs({ reason: error.reason._tag }),
                  logged,
                  Effect.as(undefined),
                ),
              ),
            );
            if (canonical === undefined) return null;
            if (canonical === null) {
              yield* Effect.logWarning(
                "Ignored an approved folder that does not resolve",
              ).pipe(logged);
              return null;
            }
            yield* SubscriptionRef.updateSomeEffect(approved, (folders) => {
              if (folders.includes(canonical)) return Effect.succeedNone;
              const granted = [...folders, canonical];
              return save(granted).pipe(Effect.as(Option.some(granted)));
            });
            yield* rebuildRoots;
            return canonical;
          },
        ),
        revokeFolder: Effect.fn("AttachmentImport.revokeFolder")(
          function* (folder) {
            const revoked = yield* SubscriptionRef.modifySomeEffect(
              approved,
              (folders) => {
                const remaining = folders.filter((path) => path !== folder);
                if (remaining.length === folders.length)
                  return Effect.succeed([false, Option.none()] as const);
                return save(remaining).pipe(
                  Effect.as([true, Option.some(remaining)] as const),
                );
              },
            );
            if (revoked) yield* rebuildRoots;
          },
        ),
        skipped: Stream.fromPubSub(skipped),
        prepare: Effect.fn("AttachmentImport.prepare")(
          function* (notePath, prepareOptions) {
            const current = yield* settings.current;
            const importEnabled = current["attachment.import"];
            let folderPath: string | null = null;
            if (importEnabled) {
              const cache = prepareOptions?.folderCache;
              const cacheKey = noteDirname(notePath);
              const cached = cache?.get(cacheKey);
              if (cached === undefined) {
                folderPath = yield* attachmentFolderPath(
                  current["attachment.folder-path"],
                  notePath,
                ).pipe(Effect.provideService(FileManager, fileManager));
                cache?.set(cacheKey, folderPath);
              } else {
                folderPath = cached;
              }
              yield* rebuildRoots;
            }
            yield* Effect.logDebug("Prepared attachment import").pipe(
              Effect.annotateLogs({ notePath, importEnabled, folderPath }),
              logged,
            );
            return makeBatch({ notePath, folderPath, importEnabled });
          },
        ),
      });
    }),
  );

function absoluteVaultPath(
  basePath: string,
  vaultPath: string,
  folderPath: string,
): string {
  const dest = join(basePath, vaultPath);
  assertContained(join(basePath, folderPath), dest);
  return dest;
}

function assertContained(root: string, dest: string): void {
  const rel = relative(root, dest);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Attachment destination escaped the attachment folder");
  }
}
