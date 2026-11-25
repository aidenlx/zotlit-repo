import { FileSystem, Layer, Stream } from "effect";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import { FileManager } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import { CapabilityNotices } from "@zotlit/annotations/obsidian/annotation-repository/notices.ts";
import { AnnotationRepository } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import { CitationLookup } from "@zotlit/citations/obsidian/citation-index/lookup-service.ts";
import { CitationText } from "@zotlit/citations/obsidian/citation-text/service.ts";
import { CitekeyEditor } from "@zotlit/citations/obsidian/citekey-editor/service.ts";
import { BibliographyRender } from "@zotlit/citations/obsidian/pandoc/render-cache.ts";
import { PandocEngine } from "@zotlit/citations/obsidian/pandoc/service.ts";
import { CitationParse } from "@zotlit/citations/obsidian/citation-parse/service.ts";
import { CitationIndex } from "@zotlit/citations/obsidian/citation-index/service.ts";
import { ExcerptDisplays } from "@zotlit/annotations/desktop/excerpt-image/display.ts";
import { ItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import { QueryService } from "@zotlit/query-views/desktop/item-query/service.ts";
import { ItemMatchQuery } from "@zotlit/notes/core/profile-selection/item-matches.ts";
import { TemplateWorkbenchLauncher } from "@zotlit/notes/obsidian/template/workbench-launcher.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import { NoteFeature } from "@zotlit/notes/desktop/note-feature/service.ts";
import { AnnotationNoteActions } from "@zotlit/annotations/obsidian/annot-view/note-actions.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PdfAnnotationEditor } from "@zotlit/annotations/obsidian/pdf-annotation-editor/service.ts";
import { ProfileStyles } from "@zotlit/citations/obsidian/pandoc/profile-styles.ts";
import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import { Release } from "@zotlit/library-view/obsidian/release/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { TemplateDataReads } from "@zotlit/notes/desktop/template/data-reads.ts";
import { TemplateMigration } from "@zotlit/notes/desktop/template/migration.ts";
import { Template } from "@zotlit/notes/obsidian/template/service.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import { ShowInLibrary } from "@zotlit/obsidian-kit/show-in-library.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { ReaderConnection } from "@zotlit/annotations/obsidian/reader-connection/service.ts";

export const layerUnreadViewServices = Layer.mergeAll(
  Layer.mock(PdfAnnotationEditor, {
    extension: { id: "zotlit-annotation-editor" },
    sessions: Stream.make(new Map()),
    sessionAdded: Stream.empty,
  }),
  Layer.mock(CitationParse, {}),
  Layer.mock(PandocEngine, {}),
  Layer.mock(BibliographyRender, {}),
  Layer.mock(CitekeyEditor, {}),
  Layer.mock(CitationText, {}),
  Layer.mock(
    ExcerptDisplays,
    stubService<ExcerptDisplays["Service"]>("ExcerptDisplays", {}),
  ),
  Layer.mock(AnnotationNoteActions, {}),
  Layer.mock(CapabilityNotices, {}),
  Layer.mock(AnnotationRepository, {}),
  Layer.mock(LocalServer, {}),
  Layer.mock(CitationIndex, {}),
  Layer.mock(CitationLookup, {}),
  Layer.mock(FileManager, {}),
  Layer.succeed(
    FileSystem.FileSystem,
    stubService<FileSystem.FileSystem>("FileSystem", {}),
  ),
  Layer.mock(
    ObsidianEnv,
    stubService<ObsidianEnv["Service"]>("ObsidianEnv", {}),
  ),
  Layer.mock(
    VaultDisk,
    stubService<VaultDisk["Service"]>("VaultDisk", {}),
  ),
  Layer.mock(ItemLookup, {}),
  Layer.mock(NoteIndex, {}),
  Layer.mock(NoteFeature, {}),
  Layer.mock(Profile, {}),
  Layer.mock(
    ProfileStyles,
    stubService<ProfileStyles["Service"]>("ProfileStyles", {}),
  ),
  Layer.mock(Template, {}),
  Layer.mock(Notifier, {}),
  Layer.mock(QueryService, {}),
  Layer.mock(ItemMatchQuery, {}),
  Layer.mock(TemplateWorkbenchLauncher, {}),
  Layer.mock(LibraryScope, {}),
  Layer.mock(UseLedger, {}),
  Layer.mock(PluginSettings, {}),
  Layer.mock(Release, { version: "" }),
  Layer.mock(ShowInLibrary, {}),
  Layer.mock(QueryClients, {
    client: stubService<QueryClients["Service"]["client"]>("QueryClient", {}),
  }),
  Layer.mock(TemplateMigration, {}),
  Layer.mock(ZoteroPref, {}),
  Layer.mock(ReaderConnection, {}),
  Layer.succeed(ObsidianApp, stubService<ObsidianApp["Service"]>("App", {})),
  Layer.mock(TemplateDataReads, {}),
  Layer.mock(ZoteroReads, {
    reads: stubService<ZoteroReads["Service"]["reads"]>("ZoteroReadsApi", {}),
  }),
);
