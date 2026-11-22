import { ShowInLibrary } from "@zotlit/obsidian-kit/show-in-library.ts";
import { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { bindManagedBinary } from "@zotlit/plugin-services/obsidian/managed-binary/handle.ts";
import { ResourcePackPlatform } from "@zotlit/plugin-services/obsidian/managed-binary/pack-platform.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import {
  defineFeature,
  registration,
  serviceGroup,
} from "@zotlit/plugin-shell/obsidian/feature.ts";
import { advancedPageSlots } from "@zotlit/plugin-shell/obsidian/setting-pages/advanced.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { layerAnnotationLinkReading } from "./annotation-popover/reading.ts";
import { layerCitationsCli } from "./citation-index/cli/register.ts";
import {
  CitationLookup,
  layerCitationLookup,
} from "./citation-index/lookup-service.ts";
import { citationIndexResetItem } from "./citation-index/reset.ts";
import { CitationIndex, layerCitationIndex } from "./citation-index/service.ts";
import { citationsPage } from "./citation-index/settings-page.ts";
import { CitationParse } from "./citation-parse/service.ts";
import { CitationPopover } from "./citation-popover/service.ts";
import { CitationText, layerCitationText } from "./citation-text/service.ts";
import { addCitekeyEditorActions } from "./citekey-editor/actions.ts";
import { layerCitekeyCandidatePicker } from "./citekey-editor/candidates.ts";
import { CitekeyNoteActions } from "./citekey-editor/note-actions.ts";
import { layerCitekeyEditorNotices } from "./citekey-editor/notices.ts";
import { layerCitekeyEditorExtension } from "./citekey-editor/register.ts";
import { CitekeyEditor, layerCitekeyEditor } from "./citekey-editor/service.ts";
import { layerCitekeyReading } from "./citekey-reading/service.ts";
import { addGraphCitationsActions } from "./graph-citations/actions.ts";
import {
  GraphCitations,
  layerGraphCitations,
} from "./graph-citations/service.ts";
import { layerCitationStyleNotice } from "./pandoc/notices.ts";
import { ProfileStyles } from "./pandoc/profile-styles.ts";
import { BibliographyRender } from "./pandoc/render-cache.ts";
import { layerPandocEngine, PandocEngine } from "./pandoc/service.ts";
import { layerWikilinkEditor } from "./wikilink-editor/service.ts";
import { layerWikilinkReading } from "./wikilink-reading/service.ts";

import { citationSettings } from "#core/citation-index/settings.ts";

export const citations = defineFeature({
  name: "citations",
  settings: [citationSettings],
  services: [
    serviceGroup(
      "PandocEngine",
      { provides: [PandocEngine], requires: [ResourcePackPlatform] },
      layerPandocEngine,
    ),
    serviceGroup(
      "CitationLookup",
      {
        provides: [CitationLookup],
        requires: [LibraryScope, QueryClients, ZoteroReads],
      },
      layerCitationLookup,
    ),
    serviceGroup(
      "CitationIndex",
      {
        provides: [CitationIndex],
        requires: [
          CitationLookup,
          CitationParse,
          LibraryScope,
          NoteIndex,
          ZoteroReads,
        ],
      },
      layerCitationIndex(),
    ),
    serviceGroup(
      "CitationText",
      {
        provides: [CitationText],
        requires: [
          BibliographyRender,
          CitationIndex,
          CitationLookup,
          NoteIndex,
          ProfileStyles,
          QueryClients,
        ],
      },
      layerCitationText(),
    ),
    serviceGroup(
      "CitekeyEditor",
      {
        provides: [CitekeyEditor],
        requires: [
          CitekeyNoteActions,
          CitationLookup,
          LibraryScope,
          NoteIndex,
          ZoteroReads,
        ],
      },
      layerCitekeyEditor,
    ),
    serviceGroup(
      "GraphCitations",
      {
        provides: [GraphCitations],
        requires: [
          CitationIndex,
          CitationLookup,
          CitationPopover,
          CitekeyEditor,
          LibraryScope,
          NoteIndex,
          ShowInLibrary,
          ZoteroReads,
        ],
      },
      layerGraphCitations,
    ),
  ],
  registrations: [
    registration("AnnotationLinkReading", layerAnnotationLinkReading),
    registration("CitationsCli", layerCitationsCli),
    registration("CitationStyleNotice", layerCitationStyleNotice),
    registration("CitekeyCandidatePicker", layerCitekeyCandidatePicker),
    registration("CitekeyEditorExtension", layerCitekeyEditorExtension),
    registration("CitekeyEditorNotices", layerCitekeyEditorNotices),
    registration("CitekeyReading", layerCitekeyReading),
    registration("WikilinkEditor", layerWikilinkEditor),
    registration("WikilinkReading", layerWikilinkReading),
  ],
  settingTab: {
    entries: { citations: (ctx) => [citationsPage(ctx)] },
    slots: {
      [advancedPageSlots.recovery]: (ctx) => [citationIndexResetItem(ctx)],
    },
  },
  handles: ({ bridge, read }) => {
    const citationLookup = read(CitationLookup);
    const citationIndex = read(CitationIndex);
    return {
      citationLookup,
      citationIndex,
      citationSuggestServices: {
        citationLookup,
        citationIndex,
        useLedger: read(UseLedger),
      },
      pandocEngine: bindManagedBinary(bridge, read(PandocEngine)),
      citationText: read(CitationText),
      profileStyles: read(ProfileStyles),
      citekeyEditor: read(CitekeyEditor),
      graphCitations: read(GraphCitations),
    };
  },
  onload: ({ plugin, app, bridge, read }) => {
    addCitekeyEditorActions(plugin, {
      citekeyEditor: read(CitekeyEditor),
      bridge,
    });
    addGraphCitationsActions(plugin, {
      app,
      graphCitations: read(GraphCitations),
      bridge,
    });
  },
});
