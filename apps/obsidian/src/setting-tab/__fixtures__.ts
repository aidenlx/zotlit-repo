// The tab service over the host's services, for the rows the host keeps and
// the tab class.

import { Context, Effect, FileSystem, Layer } from "effect";

import { ExcerptDisplays } from "@zotlit/annotations/desktop/excerpt-image/display.ts";
import { CapabilityNotices } from "@zotlit/annotations/obsidian/annotation-repository/notices.ts";
import { AnnotationRepository } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import { ExcerptImageService } from "@zotlit/annotations/obsidian/excerpt-image/service.ts";
import { CitationIndex } from "@zotlit/citations/obsidian/citation-index/service.ts";
import { PandocEngine } from "@zotlit/citations/obsidian/pandoc/service.ts";
import { Release } from "@zotlit/library-view/obsidian/release/service.ts";
import { NoteFeature } from "@zotlit/notes/desktop/note-feature/service.ts";
import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { Template } from "@zotlit/notes/obsidian/template/service.ts";
import { TemplateWorkbenchLauncher } from "@zotlit/notes/obsidian/template/workbench-launcher.ts";
import { FileManager } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { settingTabHarness } from "@zotlit/plugin-services/__fixtures__/setting-tab-harness.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { AttachmentImport } from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import { ChineseSegmenter } from "@zotlit/plugin-services/obsidian/chinese-segmenter/service.ts";
import { LanguagePack } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { ZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";
import { Customize } from "@zotlit/template-workbench/desktop/local-bridge/customize.ts";
import { LocalBridge } from "@zotlit/template-workbench/desktop/local-bridge/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsApi } from "@zotlit/zotero-reads/client/service.ts";

/**
 * Every service the tab reads, with no member implemented: a test's own
 * services replace these, and a member no test gave fails that Effect with an
 * unimplemented defect.
 */
export const unimplementedTabServices = Layer.mergeAll(
  Layer.mock(PluginSettings)({}),
  Layer.mock(Profile)({}),
  Layer.mock(Template)({}),
  Layer.mock(ZoteroPref)({}),
  Layer.mock(ZoteroReads)({
    reads: stubService<ZoteroReadsApi>("ZoteroReads.reads", {}),
  }),
  Layer.mock(LibraryScope)({}),
  Layer.mock(LocalServer)({}),
  Layer.mock(Release)({ version: "0.0.0" }),
  Layer.mock(AnnotationRepository)({}),
  Layer.mock(ZoteroLocalApi)({}),
  Layer.mock(CapabilityNotices)({}),
  Layer.mock(CitationIndex)({}),
  Layer.mock(PandocEngine)({}),
  Layer.mock(ChineseSegmenter)({}),
  Layer.mock(AttachmentImport)({}),
  Layer.mock(LocalBridge)({}),
  Layer.mock(Customize)({}),
  Layer.mock(TemplateWorkbenchLauncher)({}),
  // Services with plain members: a read of a member no test gave throws.
  Layer.succeed(
    LanguagePack,
    stubService<LanguagePack["Service"]>("LanguagePack", {}),
  ),
  Layer.succeed(
    ExcerptImageService,
    stubService<ExcerptImageService["Service"]>("ExcerptImages", {}),
  ),
  Layer.succeed(
    ExcerptDisplays,
    stubService<ExcerptDisplays["Service"]>("ExcerptDisplays", {}),
  ),
  Layer.mock(NoteFeature)({}),
  Layer.mock(NoteIndex)({}),
  Layer.mock(Vault)({}),
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

export const { scopedSettingTab, rebuildingSettingTab, testSettingTab } =
  settingTabHarness(unimplementedTabServices);

/**
 * The Profile, Template and Vault reads of the Profile and Template rows:
 * a loaded registry with no Profile, no excluded document, no partial and no
 * saved Default document, unless a test overrides a member.
 */
export function profileRowServices(
  overrides: {
    profile?: Partial<Profile["Service"]>;
    template?: Partial<Template["Service"]>;
    vault?: Partial<Vault["Service"]>;
  } = {},
) {
  return Context.make(
    Profile,
    stubService<Profile["Service"]>("Profile", {
      loaded: Effect.succeed(true),
      profiles: Effect.succeed([]),
      diagnostics: Effect.succeed([]),
      defaultDocumentPath: Effect.succeed(
        "templates/zotlit-profile.default.md",
      ),
      ...overrides.profile,
    }),
  ).pipe(
    Context.add(
      Template,
      stubService<Template["Service"]>("Template", {
        loaded: Effect.succeed(true),
        javascriptTemplatesEnabled: Effect.succeed(false),
        getPartialDocuments: Effect.succeed([]),
        getReservedPartialFiles: Effect.succeed([]),
        getUnrecognizedFiles: Effect.succeed([]),
        ...overrides.template,
      }),
    ),
    Context.add(
      Vault,
      stubService<Vault["Service"]>("Vault", {
        getFileByPath: () => Effect.succeed(null),
        ...overrides.vault,
      }),
    ),
  );
}
