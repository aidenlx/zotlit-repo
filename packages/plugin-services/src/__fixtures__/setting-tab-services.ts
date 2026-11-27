import { Effect, FileSystem, Layer, Stream } from "effect";

import { FileManager } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsApi } from "@zotlit/zotero-reads/client/service.ts";

import { LocalServer } from "#core/local-server/service.ts";
import { ZoteroPref } from "#core/zotero-pref/service.ts";
import { AttachmentImport } from "#desktop/attachment-import/service.ts";
import { ChineseSegmenter } from "#obsidian/chinese-segmenter/service.ts";
import { LanguagePack } from "#obsidian/language-pack/service.ts";
import { LibraryScope } from "#obsidian/library-scope/service.ts";
import { LibrarySource } from "#obsidian/library-source/service.ts";
import type { LibrarySourceView } from "#obsidian/library-source/service.ts";
import { NoteIndex } from "#obsidian/note-index/service.ts";
import { PluginSettings } from "#obsidian/settings/service.ts";

const FILE_SOURCE_VIEW: LibrarySourceView = {
  selected: "file",
  status: { kind: "file-source" },
  actions: { syncNow: false, replace: null, remove: true },
};

export const unimplementedPlatformTabServices = Layer.mergeAll(
  Layer.mock(PluginSettings)({}),
  Layer.mock(ZoteroPref)({}),
  Layer.mock(ZoteroReads)({
    reads: stubService<ZoteroReadsApi>("ZoteroReads.reads", {}),
  }),
  Layer.mock(LibraryScope)({}),
  Layer.mock(LibrarySource)({
    active: "file",
    reads: null,
    view: Effect.succeed(FILE_SOURCE_VIEW),
    viewChanges: Stream.make(FILE_SOURCE_VIEW),
    language: Effect.succeed({
      setting: "auto",
      automatic: "en-US",
      effective: "en-US",
    }),
  }),
  Layer.succeed(
    ObsidianEnv,
    stubService<ObsidianEnv["Service"]>("ObsidianEnv", { language: "en" }),
  ),
  Layer.mock(LocalServer)({}),
  Layer.mock(ChineseSegmenter)({}),
  Layer.mock(AttachmentImport)({}),
  Layer.succeed(
    LanguagePack,
    stubService<LanguagePack["Service"]>("LanguagePack", {}),
  ),
  Layer.mock(NoteIndex)({}),
  Layer.mock(Vault)({}),
  Layer.mock(VaultDisk)({ basePath: "/vault" }),
  Layer.mock(Workspace)({}),
  Layer.mock(FileManager)({}),
  Layer.succeed(
    PluginHost,
    stubService<PluginHost["Service"]>("PluginHost", {}),
  ),
  Layer.succeed(
    FileSystem.FileSystem,
    stubService<FileSystem.FileSystem>("FileSystem", {}),
  ),
);
