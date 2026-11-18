// The plugin's services that live in the Effect Layer graph, converted or bridged.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Layer } from "effect";
import type { FileSystem } from "effect";
import type { Plugin } from "obsidian";

import type { CliHost } from "@zotlit/obsidian-kit/cli-command.ts";
import { layerRequestUrlHttpClient } from "@zotlit/obsidian-kit/http-client.ts";
import { layerNotifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { layerDeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import type { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { layerObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { layerFileManager } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import type { FileManager } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import { layerMetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import type { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { layerVault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import type { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import type { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { layerWorkspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { openSettingsTab } from "@zotlit/obsidian-kit/open-settings.ts";
import { layerPluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { layerViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import type { ViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import { WEB_WORKBENCH_ENABLED } from "@zotlit/plugin-kernel/constants.ts";
import type { ZoteroHttp } from "@zotlit/plugin-kernel/zotero-http.ts";

import { layerAnnotationNoteActions } from "@/services/note-feature/view-actions.ts";
import type { AnnotationNoteActions } from "@/services/note-feature/view-actions.ts";
import { layerTemplateDataReads } from "@/services/template-workbench/data-reads.ts";
import { layerSettingTab } from "@/setting-tab/layer.ts";
import {
  layerShowInLibrary,
  openLibraryView,
} from "@/views/library/register.ts";
import { layerShowInLibraryActions } from "@/views/library/show-in-library-actions.ts";
import type { ShowInLibrary } from "@/views/library/show-in-library.ts";
import { layerZoteroHttpNode } from "@/zotero-http-node.ts";

import { layerAnnotationLinkReading } from "./annotation-popover/reading.ts";
import { layerAnnotationPopover } from "./annotation-popover/service.tsx";
import type { AnnotationPopover } from "./annotation-popover/service.tsx";
import { layerCapabilityNotices } from "./annotation-repository/notices.ts";
import type {
  CapabilityNoticePorts,
  CapabilityNotices,
} from "./annotation-repository/notices.ts";
import { layerAnnotationRepository } from "./annotation-repository/service.ts";
import type { AnnotationRepository } from "./annotation-repository/service.ts";
import { layerAttachmentSkipNotice } from "./attachment-import/notices.ts";
import { layerAttachmentImport } from "./attachment-import/service.ts";
import type { AttachmentImport } from "./attachment-import/service.ts";
import { openWithSystem } from "./attachment-open/capture.ts";
import { layerTargetOpener } from "./attachment-open/open-target.ts";
import type { TargetOpener } from "./attachment-open/open-target.ts";
import { pdfReader } from "./attachment-open/pdf-reader.ts";
import { layerAttachmentResolver } from "./attachment-resolver/service.ts";
import type { AttachmentResolver } from "./attachment-resolver/service.ts";
import { layerChineseSegmenter } from "./chinese-segmenter/service.ts";
import type { ChineseSegmenter } from "./chinese-segmenter/service.ts";
import { layerCitationsCli } from "./citation-index/cli/register.ts";
import { layerCitationLookup } from "./citation-index/lookup-service.ts";
import type { CitationLookup } from "./citation-index/lookup-service.ts";
import { layerCitationIndex } from "./citation-index/service.ts";
import type { CitationIndex } from "./citation-index/service.ts";
import { layerCitationParse } from "./citation-parse/service.ts";
import type { CitationParse } from "./citation-parse/service.ts";
import { layerCitationPopover } from "./citation-popover/service.tsx";
import type { CitationPopover } from "./citation-popover/service.tsx";
import { layerCitationText } from "./citation-text/service.ts";
import type { CitationText } from "./citation-text/service.ts";
import { layerCitekeyCandidatePicker } from "./citekey-editor/candidates.ts";
import { layerCitekeyEditorNotices } from "./citekey-editor/notices.ts";
import { layerCitekeyEditorExtension } from "./citekey-editor/register.ts";
import { layerCitekeyEditor } from "./citekey-editor/service.ts";
import type { CitekeyEditor } from "./citekey-editor/service.ts";
import { layerCitekeyReading } from "./citekey-reading/service.ts";
import { layerDatabaseActions } from "./database/actions.ts";
import { layerExcerptDisplays } from "./excerpt-image/display.ts";
import type { ExcerptDisplays } from "./excerpt-image/display.ts";
import { layerExcerptImages } from "./excerpt-image/layer.ts";
import { layerExcerptPreparation } from "./excerpt-image/prepare.ts";
import type { ExcerptPreparation } from "./excerpt-image/prepare.ts";
import type { ExcerptReaderDocuments } from "./excerpt-image/reader-borrow.ts";
import { layerAnnotationImageCli } from "./excerpt-image/register-cli.ts";
import { layerExcerptRevalidation } from "./excerpt-image/revalidation.ts";
import type { ExcerptImageService } from "./excerpt-image/service.ts";
import type { ExcerptStore } from "./excerpt-image/store.ts";
import { layerGraphCitations } from "./graph-citations/service.ts";
import type { GraphCitations } from "./graph-citations/service.ts";
import { layerItemLookup } from "./item-lookup/service.ts";
import type { ItemLookup } from "./item-lookup/service.ts";
import { layerQueryCli } from "./item-query/cli.ts";
import { layerQueryMeasureCli } from "./item-query/measure.ts";
import { layerQueryService } from "./item-query/service.ts";
import type { QueryService } from "./item-query/service.ts";
import { layerLanguagePackNotices } from "./language-pack/notices.ts";
import { layerLanguagePack } from "./language-pack/service.ts";
import type {
  LanguagePack,
  LanguagePackStartup,
} from "./language-pack/service.ts";
import { layerLibraryScopeCli } from "./library-scope/cli.ts";
import { layerLibraryScopeNotices } from "./library-scope/notices.ts";
import { layerLibraryScope } from "./library-scope/service.ts";
import type { LibraryScope } from "./library-scope/service.ts";
import { layerCustomize } from "./local-bridge/customize.ts";
import type { Customize, CustomizePorts } from "./local-bridge/customize.ts";
import { layerLocalBridge } from "./local-bridge/service.ts";
import type { LocalBridge } from "./local-bridge/service.ts";
import { layerLocalServer } from "./local-server/service.ts";
import type { LocalServer } from "./local-server/service.ts";
import { layerLogging, layerLogOutput } from "./log/service.ts";
import { layerManagedBinaryPlatform } from "./managed-binary/service.ts";
import type { InteractiveCreationPorts } from "./note-feature/creation-view.ts";
import { layerNoteFeatureNotices } from "./note-feature/notices.ts";
import { layerNoteFeature } from "./note-feature/service.ts";
import type { NoteFeature } from "./note-feature/service.ts";
import { layerNoteImportCommands } from "./note-import/commands.ts";
import { layerNoteImporter } from "./note-import/service.ts";
import type { NoteImporter } from "./note-import/service.ts";
import { layerNoteIndex } from "./note-index/service.ts";
import type { NoteIndex } from "./note-index/service.ts";
import { layerCitationStyleNotice } from "./pandoc/notices.ts";
import { layerPandocResolve } from "./pandoc/register.ts";
import { layerBibliographyRender } from "./pandoc/render-cache.ts";
import type { BibliographyRender } from "./pandoc/render-cache.ts";
import { layerPandocEngine } from "./pandoc/service.ts";
import type { PandocEngine } from "./pandoc/service.ts";
import { layerPdfAnnotationEditor } from "./pdf-annotation-editor/service.ts";
import type {
  PdfAnnotationEditor,
  PdfAnnotationEditorPorts,
} from "./pdf-annotation-editor/service.ts";
import { layerProfileActions } from "./profile/actions.ts";
import { layerProfile } from "./profile/service.ts";
import type { Profile } from "./profile/service.ts";
import { layerProtocolHandlers } from "./protocol/register.ts";
import type { ProtocolDeps } from "./protocol/register.ts";
import { layerQueryClients } from "./query-client/service.ts";
import type { QueryClients } from "./query-client/service.ts";
import { layerReleaseActions } from "./release/actions.ts";
import { layerRelease } from "./release/service.ts";
import type { Release } from "./release/service.ts";
import { layerPluginSettings } from "./settings/service.ts";
import type { PluginSettings } from "./settings/service.ts";
import { startingAs } from "./startup-failure.ts";
import { layerTemplateWorkbenchCli } from "./template-workbench/register.ts";
import { layerCitationTemplateActions } from "./template/actions.ts";
import { readMigrationVerificationData } from "./template/migration-data.ts";
import { layerTemplateMigration } from "./template/migration.ts";
import type {
  TemplateMigration,
  TemplateMigrationOptions,
} from "./template/migration.ts";
import { layerTemplate } from "./template/service.ts";
import type { Template } from "./template/service.ts";
import { layerUseLedger } from "./use-ledger/service.ts";
import type { UseLedger } from "./use-ledger/service.ts";
import { layerWikilinkEditor } from "./wikilink-editor/service.ts";
import { layerWikilinkReading } from "./wikilink-reading/service.ts";
import { layerZoteroLocalApi } from "./zotero-local-api/service.ts";
import type { ZoteroLocalApi } from "./zotero-local-api/service.ts";
import { SecretWriteAuthorizationStore } from "./zotero-local-api/write-authorization.ts";
import {
  layerZoteroPref,
  layerZoteroPrefFiles,
} from "./zotero-pref/service.ts";
import type { ZoteroPref } from "./zotero-pref/service.ts";
import { layerZoteroReads } from "./zotero-reads/service.ts";
import type { ZoteroReads } from "./zotero-reads/service.ts";
import { workerClient } from "./zotero-reads/worker-client.ts";

/**
 * The graph `createPluginRuntime` builds over `plugin`: every plugin
 * service. Settings and logging build first, so every other service
 * logs from its first line and closes before them. Every service reads time
 * from the Effect Clock, which a test replaces. Each layer starts under its
 * service's name, so a defect during acquisition names what failed.
 *
 * The Language Pack starts from what `startLanguagePack` applied before the
 * graph, so every service's copy already reads in the user's language.
 *
 * Above the services sit the layers that register a service's notices and
 * commands on `plugin`. They hold no service of their own, so unloading the
 * plugin releases them before the services they read.
 */
export function pluginLayer(
  plugin: Plugin & CliHost,
  migration: Pick<TemplateMigrationOptions, "openPrompt">,
  {
    capabilityNotices,
    creation,
    customize,
    excerpt,
    languagePack,
    protocol,
    pdfEditor,
  }: {
    readonly capabilityNotices: CapabilityNoticePorts;
    readonly pdfEditor: PdfAnnotationEditorPorts;
    readonly creation: InteractiveCreationPorts;
    /** The launch sheet, the browser and the native editor Customize opens. */
    readonly customize: CustomizePorts;
    /**
     * The note import's modals, which the protocol handlers and the note
     * import commands open.
     */
    readonly protocol: Pick<ProtocolDeps, "noteImportView">;
    readonly excerpt: {
      readonly openStore: () => Promise<ExcerptStore>;
      readonly readers: ExcerptReaderDocuments;
    };
    readonly languagePack: LanguagePackStartup;
  },
): Layer.Layer<
  | GraphCitations
  | PdfAnnotationEditor
  | LanguagePack
  | LocalBridge
  | Notifier
  | AnnotationRepository
  | AnnotationNoteActions
  | CapabilityNotices
  | AnnotationPopover
  | CitekeyEditor
  | Customize
  | ItemLookup
  | QueryService
  | ExcerptDisplays
  | ExcerptImageService
  | ExcerptPreparation
  | CitationText
  | CitationPopover
  | CitationIndex
  | BibliographyRender
  | CitationLookup
  | Profile
  | LibraryScope
  | AttachmentImport
  | TargetOpener
  | AttachmentResolver
  | ZoteroReads
  | PluginSettings
  | Release
  | UseLedger
  | QueryClients
  | CitationParse
  | ZoteroPref
  | ChineseSegmenter
  | PandocEngine
  | NoteIndex
  | NoteFeature
  | NoteImporter
  | LocalServer
  | ZoteroLocalApi
  | ZoteroHttp
  | Template
  | TemplateMigration
  | ViewRegistry
  | Vault
  | FileManager
  | Workspace
  | MetadataCache
  | ObsidianEnv
  | ShowInLibrary
  | FileSystem.FileSystem
> {
  // The file manager decides its outcomes from the vault's cache.
  const fileManager = layerFileManager.pipe(Layer.provide(layerVault));
  // What both halves read from Obsidian: the App, its environment, notices.
  const obsidian = Layer.mergeAll(
    layerNotifier,
    layerObsidianEnv,
    layerDeviceStorage,
    layerMetadataCache,
    fileManager,
    layerWorkspace,
    layerVault,
  ).pipe(Layer.provideMerge(Layer.succeed(ObsidianApp, plugin.app)));
  const services = Layer.mergeAll(
    // An Annotation Citation's hover opens the Citation Popover.
    layerAnnotationPopover.pipe(
      startingAs("AnnotationPopover"),
      Layer.provideMerge(
        layerCitationPopover.pipe(startingAs("CitationPopover")),
      ),
    ),
    layerCapabilityNotices(capabilityNotices).pipe(
      startingAs("CapabilityNotices"),
    ),
    layerItemLookup.pipe(startingAs("ItemLookup")),
    layerNoteImporter.pipe(startingAs("NoteImporter")),
    layerLocalBridge({
      webWorkbenchEnabled: WEB_WORKBENCH_ENABLED,
      pluginVersion: plugin.manifest.version,
    }).pipe(startingAs("LocalBridge")),
    layerQueryService({ pluginVersion: plugin.manifest.version }).pipe(
      startingAs("QueryService"),
    ),
  ).pipe(
    Layer.provideMerge(layerCitationText().pipe(startingAs("CitationText"))),
    Layer.provideMerge(layerCitationIndex().pipe(startingAs("CitationIndex"))),
    Layer.provideMerge(
      Layer.mergeAll(
        layerBibliographyRender.pipe(startingAs("BibliographyRender")),
        layerCitationLookup.pipe(startingAs("CitationLookup")),
      ),
    ),
    // The migration verifies a conversion against a real in-scope item.
    Layer.provideMerge(
      layerTemplateMigration({
        ...migration,
        loadVerificationData: readMigrationVerificationData,
      }).pipe(startingAs("TemplateMigration")),
    ),
    // Every ZotLit gesture that opens an Attachment, and File Link Capture
    // for a link Obsidian rendered, decides through this one opener.
    Layer.provideMerge(
      layerTargetOpener({ reader: pdfReader, native: openWithSystem }).pipe(
        startingAs("TargetOpener"),
      ),
    ),
    Layer.provideMerge(
      Layer.mergeAll(
        layerLibraryScope.pipe(startingAs("LibraryScope")),
        layerProfile.pipe(startingAs("Profile")),
        layerAttachmentResolver().pipe(startingAs("AttachmentResolver")),
        layerAttachmentImport().pipe(startingAs("AttachmentImport")),
      ),
    ),
    Layer.provideMerge(
      layerAnnotationRepository({}).pipe(startingAs("AnnotationRepository")),
    ),
    Layer.provideMerge(
      layerExcerptDisplays.pipe(startingAs("ExcerptDisplays")),
    ),
    Layer.provideMerge(
      layerExcerptPreparation.pipe(startingAs("ExcerptPreparation")),
    ),
    Layer.provideMerge(
      layerExcerptImages(excerpt).pipe(startingAs("ExcerptImages")),
    ),
    Layer.provideMerge(
      layerZoteroReads(workerClient()).pipe(startingAs("ZoteroReads")),
    ),
    Layer.provideMerge(
      // The Remembered Write Authorization lives in Obsidian's Keychain,
      // where the user can see and delete it — never in synced settings.
      layerZoteroLocalApi({
        credentials: new SecretWriteAuthorizationStore({
          secrets: plugin.app.secretStorage,
        }),
      }).pipe(startingAs("ZoteroLocalApi")),
    ),
    Layer.provideMerge(layerLocalServer.pipe(startingAs("LocalServer"))),
    Layer.provideMerge(
      Layer.mergeAll(
        layerUseLedger.pipe(startingAs("UseLedger")),
        layerRelease({
          version: plugin.manifest.version,
          // A first install or an update opens the Library View, in place of
          // the empty tab or beside the open note.
          openFirstScreen: async () => {
            await openLibraryView(plugin.app, { pane: "first-screen" });
          },
        }).pipe(startingAs("Release")),
        layerTemplate.pipe(startingAs("Template")),
        layerZoteroPref.pipe(
          Layer.provide(layerZoteroPrefFiles),
          startingAs("ZoteroPref"),
        ),
        Layer.mergeAll(
          layerChineseSegmenter.pipe(startingAs("ChineseSegmenter")),
          layerPandocEngine.pipe(startingAs("PandocEngine")),
        ).pipe(Layer.provide(layerManagedBinaryPlatform)),
        layerNoteIndex.pipe(startingAs("NoteIndex")),
        layerCitationParse.pipe(startingAs("CitationParse")),
        layerQueryClients.pipe(startingAs("QueryClients")),
        layerZoteroHttpNode.pipe(startingAs("ZoteroHttp")),
      ),
    ),
    // The note writers (`note-feature/`) create and move notes through these tags.
    // The protocol handlers also open notes through the
    // Workspace and read the vault folder from the environment. The Customize
    // flow reads the active note's paper from the metadata cache.
    Layer.provideMerge(
      Layer.mergeAll(
        layerVault,
        fileManager,
        layerWorkspace,
        layerObsidianEnv,
        layerMetadataCache,
        // Views, the popovers and commands open the Library View on an Item.
        layerShowInLibrary,
      ),
    ),
    Layer.provideMerge(
      layerLanguagePack(languagePack).pipe(
        Layer.provide(layerRequestUrlHttpClient),
        startingAs("LanguagePack"),
      ),
    ),
    Layer.provide(obsidian),
    Layer.provideMerge(
      layerLogging.pipe(
        Layer.provide(layerLogOutput(plugin)),
        startingAs("Logging"),
      ),
    ),
    Layer.provideMerge(
      layerPluginSettings(plugin).pipe(startingAs("PluginSettings")),
    ),
  );
  const registrations = Layer.mergeAll(
    layerAnnotationImageCli.pipe(startingAs("AnnotationImageCli")),
    layerAttachmentSkipNotice({
      openSettings: () => {
        openSettingsTab(plugin.app, plugin.manifest.id, [
          "settings_page_attachments",
          "settings_attachment_approved",
        ]);
      },
    }).pipe(startingAs("AttachmentSkipNotice")),
    layerAnnotationLinkReading.pipe(startingAs("AnnotationLinkReading")),
    layerCitationsCli.pipe(startingAs("CitationsCli")),
    layerCitationStyleNotice.pipe(startingAs("CitationStyleNotice")),
    layerCitationTemplateActions.pipe(startingAs("CitationTemplateActions")),
    layerCitekeyCandidatePicker.pipe(startingAs("CitekeyCandidatePicker")),
    layerCitekeyEditorExtension.pipe(startingAs("CitekeyEditorExtension")),
    layerCitekeyEditorNotices.pipe(startingAs("CitekeyEditorNotices")),
    layerCitekeyReading.pipe(startingAs("CitekeyReading")),
    layerDatabaseActions.pipe(startingAs("DatabaseActions")),
    layerExcerptRevalidation.pipe(startingAs("ExcerptRevalidation")),
    layerGraphCitations.pipe(startingAs("GraphCitations")),
    layerLanguagePackNotices.pipe(startingAs("LanguagePackNotices")),
    layerLibraryScopeCli.pipe(startingAs("LibraryScopeCli")),
    layerLibraryScopeNotices.pipe(startingAs("LibraryScopeNotices")),
    layerNoteFeatureNotices.pipe(startingAs("NoteFeatureNotices")),
    layerNoteImportCommands({ view: protocol.noteImportView }).pipe(
      startingAs("NoteImportCommands"),
    ),
    layerPandocResolve.pipe(startingAs("PandocResolve")),
    layerProfileActions.pipe(startingAs("ProfileActions")),
    layerProtocolHandlers({
      ...creation,
      ...protocol,
      webWorkbenchEnabled: WEB_WORKBENCH_ENABLED,
    }).pipe(startingAs("ProtocolHandlers")),
    layerQueryCli.pipe(startingAs("QueryCli")),
    // Measurement-only: lets packages/e2e/src/query-measure.ts read the
    // slices, statements, heap, and cancel times of a run. A dev-build port,
    // never registered in a production build.
    __DEV__
      ? layerQueryMeasureCli.pipe(startingAs("QueryMeasureCli"))
      : Layer.empty,
    layerReleaseActions.pipe(startingAs("ReleaseActions")),
    layerShowInLibraryActions.pipe(startingAs("ShowInLibraryActions")),
    layerSettingTab({ webWorkbenchEnabled: WEB_WORKBENCH_ENABLED }).pipe(
      startingAs("SettingTab"),
    ),
    layerTemplateWorkbenchCli.pipe(startingAs("TemplateWorkbenchCli")),
    layerViewRegistry.pipe(
      Layer.provideMerge(layerTemplateDataReads),
      startingAs("ViewRegistry"),
    ),
    layerWikilinkEditor.pipe(startingAs("WikilinkEditor")),
    layerWikilinkReading.pipe(startingAs("WikilinkReading")),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(layerPluginHost(plugin), obsidian, layerNotifier),
    ),
  );
  // The Note Feature plans creations through ZotLit Query, so it builds above
  // the other services. The citekey editor creates notes through it.
  // Customize launches over the Local Bridge.
  const noteFeature = Layer.mergeAll(
    layerCitekeyEditor(creation).pipe(startingAs("CitekeyEditor")),
    layerCustomize(customize).pipe(startingAs("Customize")),
  ).pipe(
    Layer.provide(layerNotifier),
    Layer.provideMerge(
      layerNoteFeature.pipe(
        startingAs("NoteFeature"),
        Layer.provideMerge(services),
      ),
    ),
  );
  // The Node file system, once for the whole graph: the temp sweeps read it,
  // and so do the Profile dialogs that callers outside the graph open.
  // The Notifier is the one the layers share: the setting tab's Language Pack
  // toast shows through it.
  // An Annotation inserts into a note alike from the Annotation View and from
  // a mark dragged out of the PDF reader, so its actions build below both.
  return registrations.pipe(
    Layer.provideMerge(
      layerPdfAnnotationEditor(pdfEditor).pipe(
        startingAs("PdfAnnotationEditor"),
        Layer.provide(layerNotifier),
        Layer.provideMerge(
          layerAnnotationNoteActions.pipe(Layer.provideMerge(noteFeature)),
        ),
      ),
    ),
    Layer.provideMerge(NodeFileSystem.layer),
    Layer.merge(layerNotifier),
  );
}
