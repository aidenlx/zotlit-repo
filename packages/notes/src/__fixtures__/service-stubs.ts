import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Context, Effect, Layer } from "effect";
import type { FileSystem } from "effect";

import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { FileManager } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { Profile } from "#obsidian/profile/service.ts";
import { Template } from "#obsidian/template/service.ts";

const nodeFileSystem = Effect.runSync(
  Effect.scoped(Layer.build(NodeFileSystem.layer)),
);

export type StubbedServices =
  | ZoteroReads
  | NoteIndex
  | PluginSettings
  | Template
  | ZoteroPref
  | Vault
  | FileManager
  | Profile
  | MetadataCache
  | Workspace
  | ObsidianEnv
  | FileSystem.FileSystem;

export function serviceStubs(
  ...overrides: readonly Context.Context<never>[]
): Context.Context<StubbedServices> {
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

