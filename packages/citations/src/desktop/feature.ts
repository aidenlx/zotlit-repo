import { Effect, FileSystem } from "effect";

import { ExcerptDisplays } from "@zotlit/annotations/desktop/excerpt-image/display.ts";
import { AnnotationRepository } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { ShowInLibrary } from "@zotlit/obsidian-kit/show-in-library.ts";
import { ViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import {
  extendFeature,
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
import { pandocIntegrationDefinition } from "./pandoc/integration-settings-row.ts";
import { layerPandocResolve } from "./pandoc/register.ts";
import { layerBibliographyRender } from "./pandoc/render-cache-layer.ts";
import { registerReferencesView } from "./references/register.ts";

import { AnnotationPopover } from "#obsidian/annotation-popover/service.ts";
import { CitationLookup } from "#obsidian/citation-index/lookup-service.ts";
import { CitationIndex } from "#obsidian/citation-index/service.ts";
import { citationsPageSlots } from "#obsidian/citation-index/settings-page.ts";
import { CitationPopover } from "#obsidian/citation-popover/service.ts";
import { CitationText } from "#obsidian/citation-text/service.ts";
import { registerCitedByView } from "#obsidian/cited-by/register.ts";
import { citations as obsidianCitations } from "#obsidian/feature.ts";
import { ProfileStyles } from "#obsidian/pandoc/profile-styles.ts";
import { BibliographyRender } from "#obsidian/pandoc/render-cache.ts";
import { PandocEngine } from "#obsidian/pandoc/service.ts";

export const citations = extendFeature(obsidianCitations, {
  services: [
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
  ],
  registrations: [registration("PandocResolve", layerPandocResolve)],
  settingTab: {
    slots: {
      [citationsPageSlots.nativePandoc]: (ctx) => [
        pandocIntegrationDefinition(ctx),
      ],
    },
  },
  handles: ({ read }) => ({
    pandocExportContext: read(Effect.context<PandocExportServices>()),
    citationPopover: read(CitationPopover),
    annotationPopover: read(AnnotationPopover),
  }),
  onload: ({ plugin, app, bridge, read }) => {
    const registry = read(ViewRegistry);
    registerReferencesView(plugin, { app, registry });
    registerCitedByView(plugin, { app, registry });
    registerPandocExport(plugin, {
      app,
      context: read(Effect.context<PandocExportServices>()),
      bridge,
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
