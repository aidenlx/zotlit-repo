// The plugin's services that view atoms read, added to the view-atom registry
// of the Obsidian kit (`ViewServiceRegistry`) by declaration merging.
import type { CapabilityNotices } from "@/services/annotation-repository/notices.ts";
import type { AnnotationRepository } from "@/services/annotation-repository/service.ts";
import type { CitationLookup } from "@/services/citation-index/lookup-service.ts";
import type { CitationIndex } from "@/services/citation-index/service.ts";
import type { CitationParse } from "@/services/citation-parse/service.ts";
import type { CitationText } from "@/services/citation-text/service.ts";
import type { CitekeyEditor } from "@/services/citekey-editor/service.ts";
import type { ExcerptDisplays } from "@/services/excerpt-image/display.ts";
import type { ItemLookup } from "@/services/item-lookup/service.ts";
import type { QueryService } from "@/services/item-query/service.ts";
import type { LibraryScope } from "@/services/library-scope/service.ts";
import type { LocalServer } from "@/services/local-server/service.ts";
import type { NoteFeature } from "@/services/note-feature/service.ts";
import type { AnnotationNoteActions } from "@/services/note-feature/view-actions.ts";
import type { NoteIndex } from "@/services/note-index/service.ts";
import type { BibliographyRender } from "@/services/pandoc/render-cache.ts";
import type { PandocEngine } from "@/services/pandoc/service.ts";
import type { PdfAnnotationEditor } from "@/services/pdf-annotation-editor/service.ts";
import type { Profile } from "@/services/profile/service.ts";
import type { QueryClients } from "@/services/query-client/service.ts";
import type { Release } from "@/services/release/service.ts";
import type { PluginSettings } from "@/services/settings/service.ts";
import type { TemplateDataReads } from "@/services/template-workbench/data-reads.ts";
import type { TemplateMigration } from "@/services/template/migration.ts";
import type { Template } from "@/services/template/service.ts";
import type { UseLedger } from "@/services/use-ledger/service.ts";
import type { ZoteroPref } from "@/services/zotero-pref/service.ts";
import type { ZoteroReads } from "@/services/zotero-reads/service.ts";
import type { ShowInLibrary } from "@/views/library/show-in-library.ts";

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    PdfAnnotationEditor: PdfAnnotationEditor;
    CitationParse: CitationParse;
    PandocEngine: PandocEngine;
    BibliographyRender: BibliographyRender;
    CitekeyEditor: CitekeyEditor;
    CitationText: CitationText;
    AnnotationNoteActions: AnnotationNoteActions;
    ExcerptDisplays: ExcerptDisplays;
    CapabilityNotices: CapabilityNotices;
    AnnotationRepository: AnnotationRepository;
    LocalServer: LocalServer;
    CitationIndex: CitationIndex;
    CitationLookup: CitationLookup;
    ItemLookup: ItemLookup;
    NoteIndex: NoteIndex;
    NoteFeature: NoteFeature;
    Profile: Profile;
    Template: Template;
    QueryService: QueryService;
    LibraryScope: LibraryScope;
    UseLedger: UseLedger;
    PluginSettings: PluginSettings;
    QueryClients: QueryClients;
    Release: Release;
    ShowInLibrary: ShowInLibrary;
    TemplateDataReads: TemplateDataReads;
    TemplateMigration: TemplateMigration;
    ZoteroPref: ZoteroPref;
    ZoteroReads: ZoteroReads;
  }
}
