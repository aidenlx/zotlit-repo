import { Effect, FileSystem, Layer, Stream } from "effect";

import { ExcerptDisplays } from "@zotlit/annotations/desktop/excerpt-image/display.ts";
// Citations as one feature a host composes: the Citation Index and its
// lookups, the Document Citation Text, the popovers, the citekey editor and
// readings, the Pandoc Engine, and what they register.
import { AnnotationRepository } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { ShowInLibrary } from "@zotlit/obsidian-kit/show-in-library.ts";
import { ViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { bindManagedBinary } from "@zotlit/plugin-services/obsidian/managed-binary/handle.ts";
import { layerManagedBinaryPlatform } from "@zotlit/plugin-services/obsidian/managed-binary/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import {
  defineFeature,
  registration,
  serviceGroup,
} from "@zotlit/plugin-shell/obsidian/feature.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { layerAnnotationPopover } from "./annotation-popover/layer.tsx";
import { layerCitationPopover } from "./citation-popover/layer.tsx";
import {
  citationPresentationFileMenu,
  registerCitationPresentation,
} from "./citation-presentation/register.ts";
import { registerPandocExport } from "./pandoc-export/register.ts";
import type { PandocExportServices } from "./pandoc-export/register.ts";
import { layerPandocResolve } from "./pandoc/register.ts";
import { layerBibliographyRender } from "./pandoc/render-cache-layer.ts";
import { registerReferencesView } from "./references/register.ts";

import { citationSettings } from "#core/citation-index/settings.ts";
import { layerAnnotationLinkReading } from "#obsidian/annotation-popover/reading.ts";
import { AnnotationPopover } from "#obsidian/annotation-popover/service.ts";
import { layerCitationsCli } from "#obsidian/citation-index/cli/register.ts";
import {
  CitationLookup,
  layerCitationLookup,
} from "#obsidian/citation-index/lookup-service.ts";
import {
  CitationIndex,
  layerCitationIndex,
} from "#obsidian/citation-index/service.ts";
import { CitationParse } from "#obsidian/citation-parse/service.ts";
import { CitationPopover } from "#obsidian/citation-popover/service.ts";
import {
  CitationText,
  layerCitationText,
} from "#obsidian/citation-text/service.ts";
import { registerCitedByView } from "#obsidian/cited-by/register.ts";
import { addCitekeyEditorActions } from "#obsidian/citekey-editor/actions.ts";
import { layerCitekeyCandidatePicker } from "#obsidian/citekey-editor/candidates.ts";
import { CitekeyNoteActions } from "#obsidian/citekey-editor/note-actions.ts";
import { layerCitekeyEditorNotices } from "#obsidian/citekey-editor/notices.ts";
import { layerCitekeyEditorExtension } from "#obsidian/citekey-editor/register.ts";
import {
  CitekeyEditor,
  layerCitekeyEditor,
} from "#obsidian/citekey-editor/service.ts";
import { layerCitekeyReading } from "#obsidian/citekey-reading/service.ts";
import { addGraphCitationsActions } from "#obsidian/graph-citations/actions.ts";
import {
  GraphCitations,
  layerGraphCitations,
} from "#obsidian/graph-citations/service.ts";
import { layerCitationStyleNotice } from "#obsidian/pandoc/notices.ts";
import { ProfileStyles } from "#obsidian/pandoc/profile-styles.ts";
import { BibliographyRender } from "#obsidian/pandoc/render-cache.ts";
import { layerPandocEngine, PandocEngine } from "#obsidian/pandoc/service.ts";
import { layerWikilinkEditor } from "#obsidian/wikilink-editor/service.ts";
import { layerWikilinkReading } from "#obsidian/wikilink-reading/service.ts";

export const citations = defineFeature({
  name: "citations",
  settings: [citationSettings],
  services: [
    serviceGroup(
      "PandocEngine",
      { provides: [PandocEngine] },
      layerPandocEngine.pipe(Layer.provide(layerManagedBinaryPlatform)),
    ),
    serviceGroup(
      "BibliographyRender",
      {
        provides: [BibliographyRender],
        requires: [
          FileSystem.FileSystem,
          PandocEngine,
          ProfileStyles,
          QueryClients,
          ZoteroPref,
          ZoteroReads,
        ],
      },
      layerBibliographyRender,
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
      "CitationPopover",
      {
        provides: [CitationPopover],
        requires: [
          BibliographyRender,
          CitationIndex,
          CitationLookup,
          CitationText,
          LibraryScope,
          ProfileStyles,
          ShowInLibrary,
          ZoteroReads,
        ],
      },
      layerCitationPopover,
    ),
    // An Annotation Citation's hover opens the Citation Popover.
    serviceGroup(
      "AnnotationPopover",
      {
        provides: [AnnotationPopover],
        requires: [
          CitationPopover,
          AnnotationRepository,
          ExcerptDisplays,
          ZoteroPref,
          ZoteroReads,
        ],
      },
      layerAnnotationPopover,
    ),
    // The citekey editor creates notes through the notes feature's port.
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
    registration("PandocResolve", layerPandocResolve),
    registration("WikilinkEditor", layerWikilinkEditor),
    registration("WikilinkReading", layerWikilinkReading),
  ],
  settingTab: {
    rebuild: [
      Effect.map(PandocEngine, (engine) => Stream.drop(engine.changes, 1)),
    ],
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
      pandocExportContext: read(Effect.context<PandocExportServices>()),
      pandocEngine: bindManagedBinary(bridge, read(PandocEngine)),
      citationText: read(CitationText),
      profileStyles: read(ProfileStyles),
      citationPopover: read(CitationPopover),
      annotationPopover: read(AnnotationPopover),
      citekeyEditor: read(CitekeyEditor),
      graphCitations: read(GraphCitations),
    };
  },
  onload: ({ plugin, app, manifest, bridge, read }) => {
    addCitekeyEditorActions(plugin, {
      citekeyEditor: read(CitekeyEditor),
      bridge,
    });
    addGraphCitationsActions(plugin, {
      app,
      graphCitations: read(GraphCitations),
      bridge,
    });
    const registry = read(ViewRegistry);
    registerReferencesView(plugin, { app, registry });
    registerCitedByView(plugin, { app, registry });
    registerPandocExport(plugin, {
      app,
      context: read(Effect.context<PandocExportServices>()),
      bridge,
      openSettings: () => {
        app.setting.open();
        app.setting.openTabById(manifest.id);
      },
    });
    const presentation = {
      workspace: read(Workspace),
      metadataCache: read(MetadataCache),
      fileSystem: read(FileSystem.FileSystem),
      app,
      zoteroPref: read(ZoteroPref),
      notifier: read(Notifier),
      settings: read(PluginSettings),
      profiles: read(ProfileStyles),
      bridge,
    };
    registerCitationPresentation(plugin, presentation);
    return {
      fileMenu: {
        "citation-presentation": citationPresentationFileMenu(presentation),
      },
    };
  },
});
