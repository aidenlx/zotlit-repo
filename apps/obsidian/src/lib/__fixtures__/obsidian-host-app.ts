// A test host's capability tags, over in-memory sources (`layerHost`) or over
// the members of its `app` for a layer under test that still reads both
// (`layerHostApp`). Each capability tag adds its layer here.
import type { App } from "obsidian";

import { Layer } from "effect";
import { ObsidianApp } from "@/lib/obsidian-app.ts";
import { layerDeviceStorageFrom } from "@/lib/obsidian-device-storage.ts";
import type {
  DeviceStorage,
  DeviceStorageSource,
} from "@/lib/obsidian-device-storage.ts";
import { layerFileManagerFrom } from "@/lib/obsidian-file-manager.ts";
import type {
  FileManager,
  FileManagerSource,
} from "@/lib/obsidian-file-manager.ts";
import { layerMetadataCacheFrom } from "@/lib/obsidian-metadata-cache.ts";
import type {
  MetadataCache,
  MetadataCacheSource,
} from "@/lib/obsidian-metadata-cache.ts";
import { layerWorkspaceFrom } from "@/lib/obsidian-workspace.ts";
import type { Workspace, WorkspaceSource } from "@/lib/obsidian-workspace.ts";
import { layerVaultFrom } from "@/lib/obsidian-vault.ts";
import type { Vault, VaultSource } from "@/lib/obsidian-vault.ts";

import { MemoryDeviceStorage } from "./obsidian-device-storage.ts";
import { MemoryFileManager } from "./obsidian-file-manager.ts";
import { MemoryMetadataCache } from "./obsidian-metadata-cache.ts";
import { MemoryVault } from "./obsidian-vault.ts";
import { MemoryWorkspace } from "./obsidian-workspace.ts";

/** The Obsidian objects a test host gives the capability tags. */
export interface HostSources {
  readonly deviceStorage?: DeviceStorageSource;
  readonly fileManager?: FileManagerSource;
  readonly metadataCache?: MetadataCacheSource;
  readonly vault?: VaultSource;
  readonly workspace?: WorkspaceSource;
}

/** The capability tags a test host gives. */
export type HostTags =
  | DeviceStorage
  | FileManager
  | MetadataCache
  | Vault
  | Workspace;

/**
 * Each capability tag over its source in `sources`; a source the host leaves
 * out is an empty in-memory one.
 */
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

/** `ObsidianApp` as `app`, and each capability tag over its member of `app`. */
export function layerHostApp(
  app: App,
): Layer.Layer<ObsidianApp | HostTags> {
  return layerHost({
    deviceStorage: app,
    fileManager: app.fileManager,
    metadataCache: app.metadataCache,
    vault: app.vault,
    workspace: app.workspace,
  }).pipe(Layer.provideMerge(Layer.succeed(ObsidianApp, app)));
}
