// The plugin's services that view atoms read, added to the view-atom registry
// of the Obsidian kit (`ViewServiceRegistry`) by declaration merging. A plugin
// package registers its own services (`@zotlit/zotero-reads/client/atoms.ts`,
// the service tags of `@zotlit/plugin-services` and `@zotlit/annotations`). The Query Clients tag lives
// in that package's host-free layer, which names no view atom, so the plugin
// registers it here.

import type { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";

import type { CitationLookup } from "@/services/citation-index/lookup-service.ts";
import type { CitationIndex } from "@/services/citation-index/service.ts";
import type { CitationParse } from "@/services/citation-parse/service.ts";
import type { CitationText } from "@/services/citation-text/service.ts";
import type { CitekeyEditor } from "@/services/citekey-editor/service.ts";
import type { QueryService } from "@/services/item-query/service.ts";
import type { NoteFeature } from "@/services/note-feature/service.ts";
import type { BibliographyRender } from "@/services/pandoc/render-cache.ts";
import type { PandocEngine } from "@/services/pandoc/service.ts";
import type { Profile } from "@/services/profile/service.ts";
import type { Release } from "@/services/release/service.ts";
import type { TemplateDataReads } from "@/services/template-workbench/data-reads.ts";
import type { TemplateMigration } from "@/services/template/migration.ts";
import type { Template } from "@/services/template/service.ts";
import type { ShowInLibrary } from "@/views/library/show-in-library.ts";

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    CitationParse: CitationParse;
    PandocEngine: PandocEngine;
    BibliographyRender: BibliographyRender;
    CitekeyEditor: CitekeyEditor;
    CitationText: CitationText;
    CitationIndex: CitationIndex;
    CitationLookup: CitationLookup;
    NoteFeature: NoteFeature;
    Profile: Profile;
    Template: Template;
    QueryService: QueryService;
    QueryClients: QueryClients;
    Release: Release;
    ShowInLibrary: ShowInLibrary;
    TemplateDataReads: TemplateDataReads;
    TemplateMigration: TemplateMigration;
  }
}
