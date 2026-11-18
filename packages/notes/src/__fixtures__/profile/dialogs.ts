// The services a Profile dialog reads, for a test whose dialogs are fakes.
import { FileSystem, Layer } from "effect";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { FileManager } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsApi } from "@zotlit/zotero-reads/client/service.ts";

import { NoteFeature } from "#desktop/note-feature/service.ts";
import { Profile } from "#obsidian/profile/service.ts";
import { Template } from "#obsidian/template/service.ts";
import type { ProfileDialogServices } from "#desktop/profile/dialogs.ts";

/**
 * Every service a Profile dialog reads, with no member implemented, for a
 * caller's test whose dialogs are fakes: merge it before the test's own
 * services, which replace these.
 */
export const unimplementedProfileDialogServices = Layer.mergeAll(
  Layer.mock(Profile)({}),
  Layer.mock(Template)({}),
  Layer.mock(NoteFeature)({}),
  Layer.mock(Vault)({}),
  Layer.mock(ZoteroPref)({}),
  Layer.mock(ZoteroReads)({
    reads: stubService<ZoteroReadsApi>("ZoteroReads.reads", {}),
  }),
  Layer.mock(NoteIndex)({}),
  Layer.mock(PluginSettings)({}),
  Layer.mock(FileManager)({}),
  Layer.mock(LibraryScope)({}),
  Layer.succeed(
    FileSystem.FileSystem,
    stubService<FileSystem.FileSystem>("FileSystem", {}),
  ),
  testNotifier().layer,
) satisfies Layer.Layer<ProfileDialogServices>;
