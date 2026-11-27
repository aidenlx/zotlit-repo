import type { ZoteroPrefSnapshot } from "#core/zotero-pref/service.ts";
import type { Settings } from "#obsidian/settings/service.ts";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { join } from "node:path";

import { MemoryDeviceStorage } from "@zotlit/obsidian-kit/__fixtures__/obsidian-device-storage.ts";
import { layerTestObsidianEnv } from "@zotlit/obsidian-kit/__fixtures__/obsidian-env.ts";
import { MemoryFileManager } from "@zotlit/obsidian-kit/__fixtures__/obsidian-file-manager.ts";
import { layerHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import type { HostSources } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { layerTestVaultDisk } from "@zotlit/obsidian-kit/__fixtures__/obsidian-vault-disk.ts";
import { MemoryVault } from "@zotlit/obsidian-kit/__fixtures__/obsidian-vault.ts";

import { AttachmentImport, layerAttachmentImport } from "./service.ts";

import { ZoteroPref } from "#core/zotero-pref/service.ts";
import { PluginSettings } from "#obsidian/settings/service.ts";

export interface ZoteroLocation {
  readonly dataDir: string;
  readonly baseAttachmentPath: string | null;
}

export function snapshotAt(location: ZoteroLocation): ZoteroPrefSnapshot {
  return {
    state: "ready",
    prefs: new Map(),
    resolvedProfileDir: null,
    profileDirOverride: null,
    dataDirOverride: null,
    dataDir: location.dataDir,
    databasePath: join(location.dataDir, "zotero.sqlite"),
    sourceId: null,
    acceptedSourceIds: [],
    baseAttachmentPath: location.baseAttachmentPath,
    httpPort: null,
  };
}

export function layerAttachmentImportOver(options: {
  readonly defaults: Readonly<Settings>;
  readonly settings: Pick<
    Settings,
    "attachment.import" | "attachment.folder-path"
  >;
  readonly pref: Pick<ZoteroPref["Service"], "current" | "changes">;
  readonly host: HostSources;
  readonly basePath: string;
}): Layer.Layer<AttachmentImport> {
  return layerAttachmentImport.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(PluginSettings, {
          current: Effect.succeed({ ...options.defaults, ...options.settings }),
          changes: Stream.empty,
        }),
        Layer.mock(ZoteroPref, options.pref),
        layerHost(options.host),
        layerTestObsidianEnv(),
        layerTestVaultDisk({ basePath: options.basePath }),
        NodeFileSystem.layer,
      ),
    ),
  );
}

export interface AttachmentImportFixtureOptions extends ZoteroLocation {
  readonly defaults: Readonly<Settings>;
  readonly importEnabled?: boolean;
  readonly folderPath?: string | null;
  readonly basePath?: string;
  readonly storage?: MemoryDeviceStorage;
}

export const attachmentImportFixture = Effect.fn("attachmentImportFixture")(
  function* (options: AttachmentImportFixtureOptions) {
    const pref = yield* SubscriptionRef.make(snapshotAt(options));
    const storage = options.storage ?? new MemoryDeviceStorage();
    const vault = new MemoryVault();
    vault.addFolder("Attachments");
    const context = yield* Layer.build(
      layerAttachmentImportOver({
        defaults: options.defaults,
        settings: {
          "attachment.import": options.importEnabled ?? true,
          "attachment.folder-path":
            options.folderPath === undefined
              ? "Attachments"
              : options.folderPath,
        },
        pref: {
          current: SubscriptionRef.get(pref),
          changes: SubscriptionRef.changes(pref),
        },
        host: {
          deviceStorage: storage,
          vault,
          fileManager: new MemoryFileManager(),
        },
        basePath: options.basePath ?? "/vault",
      }),
    );
    return {
      service: Context.get(context, AttachmentImport),
      vault,
      storage,
      moveZotero: (location: ZoteroLocation, { announce = true } = {}) =>
        SubscriptionRef.update(pref, (before) => ({
          ...snapshotAt(location),
          prefs: announce ? new Map() : before.prefs,
        })),
    };
  },
);
