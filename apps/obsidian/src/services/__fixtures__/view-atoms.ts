// The view services a test host leaves unread, so its registry context is
// whole. Each member dies when called.
import { FileSystem, Layer, Stream } from "effect";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { FileManager } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import { CapabilityNotices } from "@/services/annotation-repository/notices.ts";
import { AnnotationRepository } from "@/services/annotation-repository/service.ts";
import { CitationLookup } from "@/services/citation-index/lookup-service.ts";
import { CitationText } from "@/services/citation-text/service.ts";
import { CitekeyEditor } from "@/services/citekey-editor/service.ts";
import { BibliographyRender } from "@/services/pandoc/render-cache.ts";
import { PandocEngine } from "@/services/pandoc/service.ts";
import { CitationParse } from "@/services/citation-parse/service.ts";
import { CitationIndex } from "@/services/citation-index/service.ts";
import { ExcerptDisplays } from "@/services/excerpt-image/display.ts";
import { ItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import { QueryService } from "@/services/item-query/service.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import { NoteFeature } from "@/services/note-feature/service.ts";
import { AnnotationNoteActions } from "@/services/note-feature/view-actions.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PdfAnnotationEditor } from "@/services/pdf-annotation-editor/service.ts";
import { Profile } from "@/services/profile/service.ts";
import { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import { Release } from "@/services/release/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { TemplateDataReads } from "@/services/template-workbench/data-reads.ts";
import { TemplateMigration } from "@/services/template/migration.ts";
import { Template } from "@/services/template/service.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import { ShowInLibrary } from "@/views/library/show-in-library.ts";

/**
 * Every view service outside the Obsidian host tags, as an empty mock. Merge
 * it first: a service the test reads, merged after it, takes its place.
 */
export const layerUnreadViewServices = Layer.mergeAll(
  Layer.mock(PdfAnnotationEditor, { sessions: Stream.make(new Map()), sessionAdded: Stream.empty }),
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
  Layer.mock(ItemLookup, {}),
  Layer.mock(NoteIndex, {}),
  Layer.mock(NoteFeature, {}),
  Layer.mock(Profile, {}),
  Layer.mock(Template, {}),
  Layer.mock(Notifier, {}),
  Layer.mock(QueryService, {}),
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
  Layer.mock(TemplateDataReads, {}),
  Layer.mock(ZoteroReads, {
    reads: stubService<ZoteroReads["Service"]["reads"]>("ZoteroReadsApi", {}),
  }),
);
