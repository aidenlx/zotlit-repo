import { DateTime, Effect, Schema } from "effect";

import * as m from "@zotlit/plugin-messages/messages.ts";
import { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";

export interface StoredReplicaFolder {
  readonly id: string;
  readonly bytes: number;
  readonly changed: DateTime.Utc | null;
}

export class OtherDataRefused extends Schema.TaggedError<
  OtherDataRefused,
  { readonly brand: unique symbol }
>()("OtherDataRefused", { id: Schema.String, message: Schema.String }) {}

export class ReplicaFolderRefused extends Schema.TaggedError<
  ReplicaFolderRefused,
  { readonly brand: unique symbol }
>()("ReplicaFolderRefused", { message: Schema.String }) {}

export const isVaultId = (name: string): boolean => /^[0-9a-f]{16}$/.test(name);

export interface StorageFailure {
  readonly message: () => string;
  readonly log: string;
  readonly id?: string;
  readonly path?: string;
}

export const warnAndFail =
  ({ message, log, id, path }: StorageFailure) =>
  (error: unknown) =>
    Effect.andThen(
      Effect.logWarning(log).pipe(
        Effect.annotateLogs({
          error,
          ...(id !== undefined && { id }),
          ...(path !== undefined && { path }),
        }),
      ),
      Effect.failSync(() => new DbUnavailable({ message: message() })),
    );

export const changedAt = (millis: number | null): DateTime.Utc | null =>
  millis === null ? null : DateTime.makeUnsafe(Math.trunc(millis));

const domError = (cause: unknown, ...names: string[]) =>
  cause instanceof DOMException && names.includes(cause.name);

const absent = (cause: unknown) => domError(cause, "NotFoundError");

export const removeOriginDirectory = Effect.fn(
  "LibrarySource.removeOriginDirectory",
)(function* (path: string) {
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) return;
  yield* Effect.tryPromise(async () => {
    try {
      let directory = await navigator.storage.getDirectory();
      for (const part of parts)
        directory = await directory.getDirectoryHandle(part);
      await directory.removeEntry(name, { recursive: true });
    } catch (cause) {
      if (!absent(cause)) throw cause;
    }
  }).pipe(
    Effect.catch((error) =>
      warnAndFail({
        message: () => m.settings_online_data_this_remove_failed(),
        log: "ZotLit could not remove the online library data of this vault",
        path,
      })(error.cause),
    ),
  );
});

export type OriginEntry =
  | (OriginDirectory & { readonly kind: "directory"; readonly name: string })
  | {
      readonly kind: "file";
      readonly name: string;
      getFile(): Promise<{
        readonly size: number;
        readonly lastModified: number;
      }>;
    };

export interface OriginDirectory {
  getDirectoryHandle(name: string): Promise<OriginDirectory>;
  removeEntry(name: string, options: { recursive: boolean }): Promise<void>;
  values(): AsyncIterable<OriginEntry>;
}

const SAH_POOL_SLOTS = ".opaque";

function originDirectory(handle: FileSystemDirectoryHandle): OriginDirectory {
  return {
    getDirectoryHandle: async (name) =>
      originDirectory(await handle.getDirectoryHandle(name)),
    removeEntry: (name, options) => handle.removeEntry(name, options),
    values: async function* () {
      for await (const entry of handle.values())
        yield entry.kind === "directory"
          ? {
              kind: "directory",
              name: entry.name,
              ...originDirectory(entry),
            }
          : {
              kind: "file",
              name: entry.name,
              getFile: () => entry.getFile(),
            };
    },
  };
}

export const openOrigin = async (): Promise<OriginDirectory> =>
  originDirectory(await navigator.storage.getDirectory());

const ineligible = (cause: unknown) =>
  domError(cause, "NotFoundError", "TypeMismatchError");

async function folderIn(
  folder: OriginDirectory,
  name: string,
): Promise<OriginDirectory | null> {
  try {
    return await folder.getDirectoryHandle(name);
  } catch (cause) {
    if (ineligible(cause)) return null;
    throw cause;
  }
}

async function absentIn(
  folder: OriginDirectory,
  name: string,
): Promise<boolean> {
  try {
    await folder.getDirectoryHandle(name);
    return false;
  } catch (cause) {
    if (absent(cause)) return true;
    if (ineligible(cause)) return false;
    throw cause;
  }
}

async function otherPoolSlots(
  store: OriginDirectory,
  root: { readonly thisVault: string },
  id: string,
): Promise<OriginDirectory | null> {
  if (!isVaultId(id) || id === root.thisVault) return null;
  const pool = await folderIn(store, id);
  return pool && (await folderIn(pool, SAH_POOL_SLOTS));
}

async function poolUse(
  slots: OriginDirectory,
): Promise<{ bytes: number; changed: number | null }> {
  let bytes = 0;
  let changed: number | null = null;
  for await (const entry of slots.values()) {
    if (entry.kind !== "file") continue;
    const slot = await entry.getFile();
    bytes += slot.size;
    changed = Math.max(changed ?? 0, slot.lastModified);
  }
  return { bytes, changed };
}

export interface PoolRoot {
  readonly open: () => Promise<OriginDirectory>;
  readonly thisVault: string;
}

export interface OtherPoolRemoval extends PoolRoot {
  readonly target: string;
}

export const listOtherPools = Effect.fn("LibrarySource.listOtherPools")(
  function* (root: PoolRoot) {
    return yield* Effect.tryPromise(
      async (): Promise<readonly StoredReplicaFolder[]> => {
        const store = await folderIn(await root.open(), "zotlit");
        if (!store) return [];
        const folders: StoredReplicaFolder[] = [];
        for await (const { name } of store.values()) {
          const slots = await otherPoolSlots(store, root, name);
          if (!slots) continue;
          const use = await poolUse(slots);
          folders.push({
            id: name,
            bytes: use.bytes,
            changed: changedAt(use.changed),
          });
        }
        return folders;
      },
    ).pipe(
      Effect.catch((error) =>
        warnAndFail({
          message: () => m.settings_online_data_others_unreadable(),
          log: "ZotLit could not read the online library data",
        })(error.cause),
      ),
    );
  },
);

export const removeOtherPool = Effect.fn("LibrarySource.removeOtherPool")(
  function* (request: OtherPoolRemoval) {
    const id = request.target;
    const other = isVaultId(id) && id !== request.thisVault;
    const store = yield* Effect.tryPromise(
      async (): Promise<OriginDirectory | "gone" | null> => {
        const found = await folderIn(await request.open(), "zotlit");
        if (!found) return other ? "gone" : null;
        if (await otherPoolSlots(found, request, id)) return found;
        return other && (await absentIn(found, id)) ? "gone" : null;
      },
    ).pipe(
      Effect.catch((error) =>
        warnAndFail({
          message: () => m.settings_online_data_others_unreadable(),
          log: "ZotLit could not read the online library data",
          id,
        })(error.cause),
      ),
    );
    if (store === "gone")
      return yield* Effect.logInfo(
        "The online library data of another vault was already removed",
      ).pipe(Effect.annotateLogs({ id }));
    if (!store)
      return yield* new OtherDataRefused({
        id,
        message: m.settings_online_data_remove_refused({ id }),
      });
    yield* Effect.tryPromise(() =>
      store.removeEntry(id, { recursive: true }),
    ).pipe(
      Effect.catch((error) =>
        warnAndFail({
          message: () => m.settings_online_data_remove_failed({ id }),
          log: "ZotLit could not remove the online library data of another vault",
          id,
        })(error.cause),
      ),
    );
    yield* Effect.logInfo(
      "Removed the online library data of another vault",
    ).pipe(Effect.annotateLogs({ id }));
  },
);
