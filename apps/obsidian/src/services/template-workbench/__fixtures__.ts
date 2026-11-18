import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import type { ManagedRuntime } from "effect";
import type { App } from "obsidian";

import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import {
  FileManager,
  layerFileManagerFrom,
} from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { layerVaultFrom, Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { LibraryScope } from "@/services/library-scope/service.ts";
import { NoteIndex } from "@/services/note-index/service.ts";
import { Profile } from "@/services/profile/service.ts";
import { PluginSettings } from "@/services/settings/service.ts";
import { Template } from "@/services/template/service.ts";
import { ZoteroPref } from "@/services/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service.ts";

import { bindTemplateData } from "./data-handle.ts";
import type { TemplateDataLoader } from "./data.ts";
import type { WorkbenchServices } from "./register.ts";

/** The services a Profile fixture's runtime holds for the Workbench. */
export type FixtureServices =
  | Profile
  | Template
  | NoteIndex
  | PluginSettings
  | Vault
  | MetadataCache
  | Workspace
  | FileManager;

/** Node's file system, which the check command reads a draft through. */
const nodeFileSystem = Effect.runSync(
  Effect.scoped(Layer.build(NodeFileSystem.layer)),
);

/**
 * The Workbench's services: a stub for each, which throws on a member the
 * test leaves unread, under `overrides`, a later one over an earlier one.
 */
export function workbenchContext(
  ...overrides: readonly Context.Context<never>[]
): Context.Context<WorkbenchServices> {
  return Context.mergeAll(
    Context.make(
      ZoteroReads,
      stubService<ZoteroReads["Service"]>("ZoteroReads", {}),
    ),
    Context.make(NoteIndex, stubService<NoteIndex["Service"]>("NoteIndex", {})),
    Context.make(
      PluginSettings,
      stubService<PluginSettings["Service"]>("PluginSettings", {}),
    ),
    Context.make(Template, stubService<Template["Service"]>("Template", {})),
    Context.make(
      ZoteroPref,
      stubService<ZoteroPref["Service"]>("ZoteroPref", {}),
    ),
    Context.make(Vault, stubService<Vault["Service"]>("Vault", {})),
    Context.make(
      FileManager,
      stubService<FileManager["Service"]>("FileManager", {}),
    ),
    Context.make(Profile, stubService<Profile["Service"]>("Profile", {})),
    Context.make(
      MetadataCache,
      stubService<MetadataCache["Service"]>("MetadataCache", {}),
    ),
    Context.make(Workspace, stubService<Workspace["Service"]>("Workspace", {})),
    Context.make(
      ObsidianEnv,
      stubService<ObsidianEnv["Service"]>("ObsidianEnv", {}),
    ),
    nodeFileSystem,
    ...overrides,
  );
}

/**
 * The real Template, Profile, Note Index, settings and capability tags of a
 * Profile fixture's runtime.
 */
export function fixtureServices(
  runtime: ManagedRuntime.ManagedRuntime<FixtureServices, never>,
): Context.Context<FixtureServices> {
  return runtime.runSync(Effect.context<FixtureServices>());
}

/** The vault and the Zotero source an envelope names. */
export function workbenchIdentity(identity: {
  vaultName?: string;
  basePath?: string;
  apiVersion?: string;
  sourceId: string | null;
  databasePath: string;
  dataDir?: string;
  baseAttachmentPath?: string | null;
}): Context.Context<ObsidianEnv | ZoteroPref> {
  const { vaultName, basePath, apiVersion, ...pref } = identity;
  return Context.make(
    ObsidianEnv,
    stubService<ObsidianEnv["Service"]>("ObsidianEnv", {
      ...(vaultName === undefined ? {} : { vaultName }),
      ...(basePath === undefined ? {} : { basePath }),
      ...(apiVersion === undefined ? {} : { apiVersion }),
    }),
  ).pipe(
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

/**
 * A Template data handle, as `plugin-runtime.ts` binds it, for a view or dialog test:
 * over `services`, and the Vault and FileManager tags over `app`'s members.
 * The tags close with `stack`.
 */
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
