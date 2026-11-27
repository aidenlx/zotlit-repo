import type { Stream } from "effect";
import { Effect, FileSystem } from "effect";
import { requestUrl } from "obsidian";

import { requireElectronRemote } from "@zotlit/obsidian-desktop/require.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import type { WorkspaceEvent } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import {
  listGoneVaultReplicas,
  removeGoneVaultReplica,
  removeVaultReplica,
  replicaFolder,
  replicaPath,
} from "@zotlit/plugin-services/desktop/library-source/stored-replica.ts";
import type {
  LibrarySourcePorts,
  WebStart,
} from "@zotlit/plugin-services/obsidian/library-source/service.ts";
import {
  listOtherPools,
  openOrigin,
  removeOriginDirectory,
  removeOtherPool,
} from "@zotlit/plugin-services/obsidian/library-source/stored-replica.ts";
import { ResourcePackPlatform } from "@zotlit/plugin-services/obsidian/managed-binary/pack-platform.ts";

import { readServerSchemaVersion } from "./schema-version.ts";
import { ZoteroReadsWebWorker } from "./web-worker-client.ts";

const WEB_API_URL_KEY = "zotlit-zotero-web-api-url";
const ONLINE_LIBRARY_ROOT_KEY = "zotlit-online-library-root";

const systemLanguage = Effect.sync((): string | null => {
  const fallback = navigator.languages[0] ?? null;
  try {
    return (
      requireElectronRemote().app.getPreferredSystemLanguages()[0] ?? fallback
    );
  } catch {
    return fallback;
  }
});

export const librarySourcePorts = Effect.fn("LibrarySource.ports")(function* (
  focusOf: (
    changes: Stream.Stream<WorkspaceEvent>,
    open: Effect.Effect<readonly Window[]>,
  ) => Stream.Stream<boolean>,
) {
  const app = yield* ObsidianApp;
  const workspace = yield* Workspace;
  const worker = yield* ZoteroReadsWebWorker;
  const pack = yield* ResourcePackPlatform;
  const fs = yield* FileSystem.FileSystem;
  type RootPorts = Pick<
    LibrarySourcePorts,
    | "startWeb"
    | "poolDirectory"
    | "removesReplicaFolder"
    | "removeStoredReplica"
    | "otherStoredReplicas"
    | "removeOtherStoredReplica"
  >;
  const replicaDirectoryOf = Effect.map(
    Effect.promise(() => import("@zotlit/zotero-reads/client/web-worker.ts")),
    ({ replicaDirectory }) => replicaDirectory,
  );
  const userData = () => requireElectronRemote().app.getPath("userData");
  const wasmRoot: RootPorts = {
    startWeb: Effect.fn("LibrarySource.startWebRoot")(function* (config) {
      const read = yield* worker.readWasm(pack);
      if (read.kind !== "ready") return read;
      return yield* worker.start(read.wasm, { config }).pipe(
        Effect.map((client): WebStart => ({ kind: "ready", client })),
        Effect.catchTag("WebWorkerCodeUnreadable", (error) =>
          Effect.as(
            Effect.logError("The online library Worker did not load", error),
            { kind: "code-unreadable" } as const,
          ),
        ),
      );
    }),
    poolDirectory: Effect.map(replicaDirectoryOf, (directory) =>
      directory(app.appId),
    ),
    removesReplicaFolder: false,
    removeStoredReplica: removeOriginDirectory,
    otherStoredReplicas: Effect.map(
      listOtherPools({ open: openOrigin, thisVault: app.appId }),
      (folders) => ({ scope: "other-folders", folders }) as const,
    ),
    removeOtherStoredReplica: (id) =>
      removeOtherPool({ open: openOrigin, thisVault: app.appId, target: id }),
  };
  const nodeRoot: RootPorts = {
    startWeb: Effect.fn("LibrarySource.startReplica")(function* (config) {
      const client = yield* worker.startReplica({
        config,
        replicaPath: replicaPath(config.poolDirectory),
      });
      return { kind: "ready", client } satisfies WebStart;
    }),
    poolDirectory: Effect.sync(() => replicaFolder(userData(), app.appId)),
    removesReplicaFolder: true,
    removeStoredReplica: () =>
      Effect.suspend(() =>
        removeVaultReplica({ userData: userData(), thisVault: app.appId }),
      ).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
    otherStoredReplicas: Effect.map(
      Effect.suspend(() =>
        listGoneVaultReplicas({ userData: userData(), thisVault: app.appId }),
      ),
      (folders) => ({ scope: "gone-vaults", folders }) as const,
    ).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
    removeOtherStoredReplica: (id) =>
      Effect.suspend(() =>
        removeGoneVaultReplica({
          userData: userData(),
          thisVault: app.appId,
          target: id,
        }),
      ).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
  };
  return {
    ...(__DEV__ && app.loadLocalStorage(ONLINE_LIBRARY_ROOT_KEY) === "web"
      ? wasmRoot
      : nodeRoot),
    systemLanguage,
    focused: focusOf(workspace.changes, workspace.windows),
    secrets: app.secretStorage,
    ...(__DEV__ && {
      webApiUrlOverride: Effect.sync(() =>
        app.loadLocalStorage(WEB_API_URL_KEY),
      ),
    }),
    serverSchemaVersion: (baseUrl) =>
      readServerSchemaVersion(requestUrl, baseUrl),
    reload: Effect.sync(() => {
      app.commands.executeCommandById("app:reload");
    }),
  } satisfies LibrarySourcePorts;
});
