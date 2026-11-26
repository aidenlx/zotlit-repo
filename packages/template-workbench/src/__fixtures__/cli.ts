import { Context, Effect, Exit, Layer, Scope } from "effect";
import type { ManagedRuntime } from "effect";
import type { App } from "obsidian";

import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import type {
  FileManager} from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import {
  layerFileManagerFrom,
} from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import type { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import type { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { layerVaultFrom } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import type { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import type { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { Template } from "@zotlit/notes/obsidian/template/service.ts";

import { bindTemplateData } from "@zotlit/notes/desktop/template/data-handle.ts";
import type { TemplateDataLoader } from "@zotlit/notes/desktop/template/data.ts";
import type { WorkbenchServices } from "#desktop/cli/register.ts";
import { serviceStubs } from "@zotlit/notes/__fixtures__/service-stubs.ts";

export type FixtureServices =
  | Profile
  | Template
  | NoteIndex
  | PluginSettings
  | Vault
  | MetadataCache
  | Workspace
  | FileManager;

export const workbenchContext: (
  ...overrides: readonly Context.Context<never>[]
) => Context.Context<WorkbenchServices> = serviceStubs;

export function fixtureServices(
  runtime: ManagedRuntime.ManagedRuntime<FixtureServices, never>,
): Context.Context<FixtureServices> {
  return runtime.runSync(Effect.context<FixtureServices>());
}

export function workbenchIdentity(identity: {
  vaultName?: string;
  basePath?: string;
  apiVersion?: string;
  sourceId: string | null;
  databasePath: string;
  dataDir?: string;
  baseAttachmentPath?: string | null;
}): Context.Context<ObsidianEnv | VaultDisk | ZoteroPref> {
  const { vaultName, basePath, apiVersion, ...pref } = identity;
  return Context.make(
    ObsidianEnv,
    stubService<ObsidianEnv["Service"]>("ObsidianEnv", {
      ...(vaultName === undefined ? {} : { vaultName }),
      ...(apiVersion === undefined ? {} : { apiVersion }),
    }),
  ).pipe(
    Context.add(
      VaultDisk,
      stubService<VaultDisk["Service"]>(
        "VaultDisk",
        basePath === undefined ? {} : { basePath },
      ),
    ),
    Context.add(
      ZoteroPref,
      stubService<ZoteroPref["Service"]>("ZoteroPref", {
        current: Effect.succeed(
          stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", pref),
        ),
      }),
    ),
  );
}

export function templateDataHandle(
  stack: AsyncDisposableStack,
  services: {
    readonly app: Pick<App, "vault" | "fileManager">;
    readonly zoteroReads: ZoteroReads["Service"];
    readonly template: Template["Service"];
    readonly settings: PluginSettings["Service"];
    readonly noteIndex: Pick<
      NoteIndex["Service"],
      "whenIndexed" | "getNotesByItemKey" | "getImportedNoteByNoteKey"
    >;
    readonly zoteroPref: Pick<
      ZoteroPrefSnapshot,
      "dataDir" | "baseAttachmentPath"
    >;
    readonly libraryScope?: LibraryScope["Service"];
  },
): TemplateDataLoader {
  const scope = Scope.makeUnsafe();
  stack.defer(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const vault = layerVaultFrom(services.app.vault);
  const capabilities = Effect.runSync(
    Layer.buildWithScope(
      Layer.merge(
        vault,
        layerFileManagerFrom(services.app.fileManager).pipe(
          Layer.provide(vault),
        ),
      ),
      scope,
    ),
  );
  return bindTemplateData(
    { runPromise: Effect.runPromise },
    Context.mergeAll(
      capabilities,
      Context.make(ZoteroReads, services.zoteroReads),
      Context.make(Template, services.template),
      Context.make(PluginSettings, services.settings),
      Context.make(
        NoteIndex,
        stubService<NoteIndex["Service"]>("NoteIndex", services.noteIndex),
      ),
      Context.make(
        ZoteroPref,
        stubService<ZoteroPref["Service"]>("ZoteroPref", {
          current: Effect.succeed(
            stubService<ZoteroPrefSnapshot>(
              "ZoteroPrefSnapshot",
              services.zoteroPref,
            ),
          ),
        }),
      ),
      Context.make(
        LibraryScope,
        services.libraryScope ??
          stubService<LibraryScope["Service"]>("LibraryScope", {}),
      ),
    ),
  );
}
