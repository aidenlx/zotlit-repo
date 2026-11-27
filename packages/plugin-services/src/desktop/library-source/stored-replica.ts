import type { StoredReplicaFolder } from "#obsidian/library-source/stored-replica.ts";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";

import * as m from "@zotlit/plugin-messages/messages.ts";
import { REPLICA_FILE } from "@zotlit/zotero-reads/contract/web-worker.ts";

import {
  changedAt,
  isVaultId,
  OtherDataRefused,
  ReplicaFolderRefused,
  warnAndFail,
} from "#obsidian/library-source/stored-replica.ts";

export function replicaFolder(userData: string, vaultId: string): string {
  return join(userData, "zotlit", vaultId);
}

export function replicaPath(folder: string): string {
  return join(folder, REPLICA_FILE);
}

const VaultRegistry = Schema.fromJsonString(
  Schema.Struct({
    vaults: Schema.Record(
      Schema.String,
      Schema.Struct({ path: Schema.String }),
    ),
  }),
);
const decodeRegistry = Schema.decodeUnknownEffect(VaultRegistry);

export interface ReplicaRoot {
  readonly userData: string;
  readonly thisVault: string;
}

export interface GoneVaultRemoval extends ReplicaRoot {
  readonly target: string;
}

const unreadableData = warnAndFail({
  message: () => m.settings_online_data_others_unreadable(),
  log: "ZotLit could not read the online library data",
});

const registeredVaults = Effect.fn("LibrarySource.registeredVaults")(function* (
  userData: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const registry = yield* fs
    .readFileString(join(userData, "obsidian.json"))
    .pipe(
      Effect.flatMap((text) => decodeRegistry(text)),
      Effect.catch(
        warnAndFail({
          message: () => m.settings_online_data_registry_unreadable(),
          log: "ZotLit could not read the vault list of Obsidian",
        }),
      ),
    );
  return new Set(Object.keys(registry.vaults));
});

const entriesOf = Effect.fn("LibrarySource.entriesOf")(function* (
  folder: string,
) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs
    .readDirectoryEntries(folder)
    .pipe(
      Effect.catchReason("PlatformError", "NotFound", () =>
        Effect.succeed<ReadonlyArray<FileSystem.DirectoryEntry>>([]),
      ),
    );
});

const typeIn = (
  entries: ReadonlyArray<FileSystem.DirectoryEntry>,
  name: string,
) => entries.find((entry) => entry.name === name)?.type ?? null;

const replicaStore = Effect.fn("LibrarySource.replicaStore")(function* (
  userData: string,
) {
  const store = typeIn(yield* entriesOf(userData), "zotlit");
  return {
    type: store,
    entries:
      store === "Directory" ? yield* entriesOf(join(userData, "zotlit")) : [],
  };
});

export const removeVaultReplica = Effect.fn("LibrarySource.removeVaultReplica")(
  function* (root: ReplicaRoot) {
    const fs = yield* FileSystem.FileSystem;
    const id = root.thisVault;
    const store = join(root.userData, "zotlit");
    const failed = (log: string, path: string) =>
      warnAndFail({
        message: () => m.settings_online_data_this_remove_failed(),
        log,
        id,
        path,
      });
    const refused = (reason: unknown) =>
      Effect.andThen(
        Effect.logWarning(
          "ZotLit did not remove the online library data of this vault: its folder is not a real folder of the replica store",
        ).pipe(Effect.annotateLogs({ reason, id, path: store })),
        Effect.failSync(
          () =>
            new ReplicaFolderRefused({
              message: m.settings_online_data_this_remove_refused({ id }),
            }),
        ),
      );
    if (!isVaultId(id)) return yield* refused("not a vault ID");
    const { type, entries } = yield* replicaStore(root.userData).pipe(
      Effect.catchTag(
        "PlatformError",
        failed("ZotLit could not read the replica store", store),
      ),
    );
    const folder = typeIn(entries, id);
    if (type === null || (type === "Directory" && folder === null))
      return yield* Effect.logDebug(
        "The online library data of this vault was already removed",
      ).pipe(Effect.annotateLogs({ id }));
    if (type !== "Directory" || folder !== "Directory")
      return yield* refused({ store: type, folder });
    const path = replicaFolder(root.userData, id);
    yield* fs
      .remove(path, { recursive: true })
      .pipe(
        Effect.catchTag(
          "PlatformError",
          failed(
            "ZotLit could not remove the online library data of this vault",
            path,
          ),
        ),
      );
    yield* Effect.logInfo("Removed the online library data of this vault").pipe(
      Effect.annotateLogs({ id }),
    );
  },
);

interface GoneVaultCheck {
  readonly root: ReplicaRoot;
  readonly known: ReadonlySet<string>;
  readonly storeType: FileSystem.File.Type | null;
  readonly entry: FileSystem.DirectoryEntry | undefined;
}

const goneVaultFolder = Effect.fn("LibrarySource.goneVaultFolder")(function* ({
  root,
  known,
  storeType,
  entry,
}: GoneVaultCheck) {
  if (storeType !== "Directory" || entry?.type !== "Directory") return false;
  const id = entry.name;
  if (!isVaultId(id) || id === root.thisVault || known.has(id)) return false;
  const inside = yield* entriesOf(replicaFolder(root.userData, id));
  return typeIn(inside, REPLICA_FILE) === "File";
});

const folderUse = (
  folder: string,
): Effect.Effect<
  { bytes: number; changed: number | null },
  PlatformError.PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    let bytes = 0;
    let changed: number | null = null;
    for (const entry of yield* fs.readDirectoryEntries(folder)) {
      const path = join(folder, entry.name);
      if (entry.type === "Directory") {
        const inner = yield* folderUse(path);
        bytes += inner.bytes;
        if (inner.changed !== null)
          changed = Math.max(changed ?? 0, inner.changed);
      } else if (entry.type === "File") {
        const info = yield* fs.stat(path);
        bytes += Number(info.size);
        if (info.mtime._tag === "Some")
          changed = Math.max(changed ?? 0, info.mtime.value.getTime());
      }
    }
    return { bytes, changed };
  });

export const listGoneVaultReplicas = Effect.fn(
  "LibrarySource.listGoneVaultReplicas",
)(function* (root: ReplicaRoot) {
  const known = yield* registeredVaults(root.userData);
  return yield* Effect.gen(function* () {
    const store = yield* replicaStore(root.userData);
    const folders: StoredReplicaFolder[] = [];
    for (const entry of store.entries) {
      if (
        !(yield* goneVaultFolder({
          root,
          known,
          storeType: store.type,
          entry,
        }))
      )
        continue;
      const use = yield* folderUse(replicaFolder(root.userData, entry.name));
      folders.push({
        id: entry.name,
        bytes: use.bytes,
        changed: changedAt(use.changed),
      });
    }
    return folders;
  }).pipe(Effect.catchTag("PlatformError", (error) => unreadableData(error)));
});

export const removeGoneVaultReplica = Effect.fn(
  "LibrarySource.removeGoneVaultReplica",
)(function* (request: GoneVaultRemoval) {
  const fs = yield* FileSystem.FileSystem;
  const id = request.target;
  const known = yield* registeredVaults(request.userData);
  const store = yield* replicaStore(request.userData).pipe(
    Effect.catchTag("PlatformError", (error) => unreadableData(error)),
  );
  const entry = store.entries.find((found) => found.name === id);
  const gone =
    isVaultId(id) &&
    id !== request.thisVault &&
    !known.has(id) &&
    (store.type === null || (store.type === "Directory" && !entry));
  if (gone)
    return yield* Effect.logInfo(
      "The online library data of another vault was already removed",
    ).pipe(Effect.annotateLogs({ id }));
  const eligible = yield* goneVaultFolder({
    root: request,
    known,
    storeType: store.type,
    entry,
  }).pipe(Effect.catchTag("PlatformError", (error) => unreadableData(error)));
  if (!eligible)
    return yield* new OtherDataRefused({
      id,
      message: m.settings_online_data_remove_refused({ id }),
    });
  yield* fs
    .remove(replicaFolder(request.userData, id), { recursive: true })
    .pipe(
      Effect.catchTag(
        "PlatformError",
        warnAndFail({
          message: () => m.settings_online_data_remove_failed({ id }),
          log: "ZotLit could not remove the online library data of another vault",
          id,
        }),
      ),
    );
  yield* Effect.logInfo(
    "Removed the online library data of another vault",
  ).pipe(Effect.annotateLogs({ id }));
});
