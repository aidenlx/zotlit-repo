import type { App } from "obsidian";

import { Layer } from "effect";
import { ObsidianApp } from "#obsidian-app.ts";
import {
  appDeviceStorageSource,
  layerDeviceStorageFrom,
} from "#obsidian-device-storage.ts";
import type {
  DeviceStorage,
  DeviceStorageSource,
} from "#obsidian-device-storage.ts";
import { layerFileManagerFrom } from "#obsidian-file-manager.ts";
import type {
  FileManager,
  FileManagerSource,
} from "#obsidian-file-manager.ts";
import { layerMetadataCacheFrom } from "#obsidian-metadata-cache.ts";
import type {
  MetadataCache,
  MetadataCacheSource,
} from "#obsidian-metadata-cache.ts";
import { layerWorkspaceFrom } from "#obsidian-workspace.ts";
import type { Workspace, WorkspaceSource } from "#obsidian-workspace.ts";
import { layerVaultFrom } from "#obsidian-vault.ts";
import type { Vault, VaultSource } from "#obsidian-vault.ts";

import { MemoryDeviceStorage } from "./obsidian-device-storage.ts";
import { MemoryFileManager } from "./obsidian-file-manager.ts";
import { MemoryMetadataCache } from "./obsidian-metadata-cache.ts";
import { MemoryVault } from "./obsidian-vault.ts";
import { MemoryWorkspace } from "./obsidian-workspace.ts";

export interface HostSources {
  readonly deviceStorage?: DeviceStorageSource;
  readonly fileManager?: FileManagerSource;
  readonly metadataCache?: MetadataCacheSource;
  readonly vault?: VaultSource;
  readonly workspace?: WorkspaceSource;
}

export type HostTags =
  | DeviceStorage
  | FileManager
  | MetadataCache
  | Vault
  | Workspace;

export function layerHost(sources: HostSources = {}): Layer.Layer<HostTags> {
  const vault = layerVaultFrom(sources.vault ?? new MemoryVault());
  return Layer.mergeAll(
    layerDeviceStorageFrom(sources.deviceStorage ?? new MemoryDeviceStorage()),
    layerMetadataCacheFrom(
      sources.metadataCache ?? new MemoryMetadataCache(),
    ),
    layerFileManagerFrom(sources.fileManager ?? new MemoryFileManager()).pipe(
      Layer.provide(vault),
    ),
    vault,
    layerWorkspaceFrom(sources.workspace ?? new MemoryWorkspace()),
  );
}

export function layerHostApp(
  app: App,
): Layer.Layer<ObsidianApp | HostTags> {
  return layerHost({
    deviceStorage: appDeviceStorageSource(app),
    fileManager: app.fileManager,
    metadataCache: app.metadataCache,
    vault: app.vault,
    workspace: app.workspace,
  }).pipe(Layer.provideMerge(Layer.succeed(ObsidianApp, app)));
}
