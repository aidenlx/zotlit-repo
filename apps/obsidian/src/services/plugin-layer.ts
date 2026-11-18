// The plugin's services that live in the Effect Layer graph, converted or bridged.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Layer } from "effect";
import type { FileSystem } from "effect";
import type { Plugin } from "obsidian";
import citationParseWorker from "virtual:citation-parse-worker";

import { openWithSystem } from "@zotlit/annotations/desktop/attachment-open/capture.ts";
import { layerTargetOpener } from "@zotlit/annotations/desktop/attachment-open/open-target.ts";
import type { TargetOpener } from "@zotlit/annotations/desktop/attachment-open/open-target.ts";
import { layerExcerptDisplays } from "@zotlit/annotations/desktop/excerpt-image/display.ts";
import type { ExcerptDisplays } from "@zotlit/annotations/desktop/excerpt-image/display.ts";
import { layerExcerptImages } from "@zotlit/annotations/desktop/excerpt-image/layer.ts";
import { layerExcerptPreparation } from "@zotlit/annotations/desktop/excerpt-image/prepare.ts";
import type { ExcerptPreparation } from "@zotlit/annotations/desktop/excerpt-image/prepare.ts";
import { layerAnnotationImageCli } from "@zotlit/annotations/desktop/excerpt-image/register-cli.ts";
import { layerExcerptRevalidation } from "@zotlit/annotations/desktop/excerpt-image/revalidation.ts";
import type { AnnotationNoteActions } from "@zotlit/annotations/obsidian/annot-view/note-actions.ts";
import { layerCapabilityNotices } from "@zotlit/annotations/obsidian/annotation-repository/notices.ts";
import type {
  CapabilityNoticePorts,
  CapabilityNotices,
} from "@zotlit/annotations/obsidian/annotation-repository/notices.ts";
import { layerAnnotationRepository } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import type { AnnotationRepository } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import type { ExcerptReaderDocuments } from "@zotlit/annotations/obsidian/excerpt-image/reader-borrow.ts";
import type { ExcerptImageService } from "@zotlit/annotations/obsidian/excerpt-image/service.ts";
import type { ExcerptStore } from "@zotlit/annotations/obsidian/excerpt-image/store.ts";
import { layerPdfAnnotationEditor } from "@zotlit/annotations/obsidian/pdf-annotation-editor/service.ts";
import type {
  PdfAnnotationEditor,
  PdfAnnotationEditorPorts,
} from "@zotlit/annotations/obsidian/pdf-annotation-editor/service.ts";
import { layerAnnotationPopover } from "@zotlit/citations/desktop/annotation-popover/layer.tsx";
import { layerCitationPopover } from "@zotlit/citations/desktop/citation-popover/layer.tsx";
import { layerPandocResolve } from "@zotlit/citations/desktop/pandoc/register.ts";
import { layerBibliographyRender } from "@zotlit/citations/desktop/pandoc/render-cache-layer.ts";
import { layerAnnotationLinkReading } from "@zotlit/citations/obsidian/annotation-popover/reading.ts";
import type { AnnotationPopover } from "@zotlit/citations/obsidian/annotation-popover/service.ts";
import { layerCitationsCli } from "@zotlit/citations/obsidian/citation-index/cli/register.ts";
import { layerCitationLookup } from "@zotlit/citations/obsidian/citation-index/lookup-service.ts";
import type { CitationLookup } from "@zotlit/citations/obsidian/citation-index/lookup-service.ts";
import { layerCitationIndex } from "@zotlit/citations/obsidian/citation-index/service.ts";
import type { CitationIndex } from "@zotlit/citations/obsidian/citation-index/service.ts";
import { layerCitationParse } from "@zotlit/citations/obsidian/citation-parse/service.ts";
import type { CitationParse } from "@zotlit/citations/obsidian/citation-parse/service.ts";
import type { CitationPopover } from "@zotlit/citations/obsidian/citation-popover/service.ts";
import { layerCitationText } from "@zotlit/citations/obsidian/citation-text/service.ts";
import type { CitationText } from "@zotlit/citations/obsidian/citation-text/service.ts";
import { layerCitekeyCandidatePicker } from "@zotlit/citations/obsidian/citekey-editor/candidates.ts";
import { layerCitekeyEditorNotices } from "@zotlit/citations/obsidian/citekey-editor/notices.ts";
import { layerCitekeyEditorExtension } from "@zotlit/citations/obsidian/citekey-editor/register.ts";
import { layerCitekeyEditor } from "@zotlit/citations/obsidian/citekey-editor/service.ts";
import type { CitekeyEditor } from "@zotlit/citations/obsidian/citekey-editor/service.ts";
import { layerCitekeyReading } from "@zotlit/citations/obsidian/citekey-reading/service.ts";
import { layerGraphCitations } from "@zotlit/citations/obsidian/graph-citations/service.ts";
import type { GraphCitations } from "@zotlit/citations/obsidian/graph-citations/service.ts";
import { layerCitationStyleNotice } from "@zotlit/citations/obsidian/pandoc/notices.ts";
import type { ProfileStyles } from "@zotlit/citations/obsidian/pandoc/profile-styles.ts";
import type { BibliographyRender } from "@zotlit/citations/obsidian/pandoc/render-cache.ts";
import { layerPandocEngine } from "@zotlit/citations/obsidian/pandoc/service.ts";
import type { PandocEngine } from "@zotlit/citations/obsidian/pandoc/service.ts";
import { layerWikilinkEditor } from "@zotlit/citations/obsidian/wikilink-editor/service.ts";
import { layerWikilinkReading } from "@zotlit/citations/obsidian/wikilink-reading/service.ts";
import type { ItemMatchQuery } from "@zotlit/notes/core/profile-selection/item-matches.ts";
import { layerCitekeyNoteActions } from "@zotlit/notes/desktop/note-feature/citekey-actions.ts";
import type { InteractiveCreationPorts } from "@zotlit/notes/desktop/note-feature/creation-view.ts";
import { layerNoteFeatureNotices } from "@zotlit/notes/desktop/note-feature/notices.ts";
import { layerNoteFeature } from "@zotlit/notes/desktop/note-feature/service.ts";
import type { NoteFeature } from "@zotlit/notes/desktop/note-feature/service.ts";
import { layerAnnotationNoteActions } from "@zotlit/notes/desktop/note-feature/view-actions.ts";
import { layerNoteImportCommands } from "@zotlit/notes/desktop/note-import/commands.ts";
import { layerNoteImporter } from "@zotlit/notes/desktop/note-import/service.ts";
import type { NoteImporter } from "@zotlit/notes/desktop/note-import/service.ts";
import { layerProfileActions } from "@zotlit/notes/desktop/profile/actions.ts";
import { layerTemplateDataReads } from "@zotlit/notes/desktop/template/data-reads.ts";
import { readMigrationVerificationData } from "@zotlit/notes/desktop/template/migration-data.ts";
import { layerTemplateMigration } from "@zotlit/notes/desktop/template/migration.ts";
import type {
  TemplateMigration,
  TemplateMigrationOptions,
} from "@zotlit/notes/desktop/template/migration.ts";
import { layerProfileStyles } from "@zotlit/notes/obsidian/profile/profile-styles.ts";
import { layerProfile } from "@zotlit/notes/obsidian/profile/service.ts";
import type { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { layerCitationTemplateActions } from "@zotlit/notes/obsidian/template/actions.ts";
import { layerTemplate } from "@zotlit/notes/obsidian/template/service.ts";
import type { Template } from "@zotlit/notes/obsidian/template/service.ts";
import type { TemplateWorkbenchLauncher } from "@zotlit/notes/obsidian/template/workbench-launcher.ts";
import { profileRevision } from "@zotlit/obsidian-desktop/profile-revision.ts";
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
import type { ShowInLibrary } from "@zotlit/obsidian-kit/show-in-library.ts";
import { layerViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import type { ViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import { WEB_WORKBENCH_ENABLED } from "@zotlit/plugin-kernel/constants.ts";
import type { ZoteroHttp } from "@zotlit/plugin-kernel/zotero-http.ts";
import type { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import { layerQueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import type { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import type { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { layerAttachmentSkipNotice } from "@zotlit/plugin-services/desktop/attachment-import/notices.ts";
import { layerAttachmentImport } from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import type { AttachmentImport } from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import { layerLocalServer } from "@zotlit/plugin-services/desktop/local-server/layer.ts";
import {
  layerZoteroPref,
  layerZoteroPrefFiles,
} from "@zotlit/plugin-services/desktop/zotero-pref/layer.ts";
import { layerAttachmentResolver } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";
import type { AttachmentResolver } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";
import { layerChineseSegmenter } from "@zotlit/plugin-services/obsidian/chinese-segmenter/service.ts";
import type { ChineseSegmenter } from "@zotlit/plugin-services/obsidian/chinese-segmenter/service.ts";
import { layerDatabaseActions } from "@zotlit/plugin-services/obsidian/database/actions.ts";
import { layerItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import type { ItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import { layerLanguagePackNotices } from "@zotlit/plugin-services/obsidian/language-pack/notices.ts";
import { layerLanguagePack } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import type {
  LanguagePack,
  LanguagePackStartup,
} from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import { layerLibraryScopeCli } from "@zotlit/plugin-services/obsidian/library-scope/cli.ts";
import { layerLibraryScopeNotices } from "@zotlit/plugin-services/obsidian/library-scope/notices.ts";
import { layerLibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import type { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import {
  layerLogging,
  layerLogOutput,
} from "@zotlit/plugin-services/obsidian/log/service.ts";
import { layerManagedBinaryPlatform } from "@zotlit/plugin-services/obsidian/managed-binary/service.ts";
import { layerNoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import type { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import type { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { layerUseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import type { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { layerZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";
import type { ZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";
import { SecretWriteAuthorizationStore } from "@zotlit/plugin-services/obsidian/zotero-local-api/write-authorization.ts";
import { layerTemplateWorkbenchCli } from "@zotlit/template-workbench/desktop/cli/register.ts";
import { layerCustomize } from "@zotlit/template-workbench/desktop/local-bridge/customize.ts";
import type {
  Customize,
  CustomizePorts,
} from "@zotlit/template-workbench/desktop/local-bridge/customize.ts";
import { layerLocalBridge } from "@zotlit/template-workbench/desktop/local-bridge/service.ts";
import type { LocalBridge } from "@zotlit/template-workbench/desktop/local-bridge/service.ts";
import { layerTemplateWorkbenchLauncher } from "@zotlit/template-workbench/desktop/view/open.ts";
import { layerZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { layerSettings } from "@/services/settings/layer.ts";
import { layerSettingTab } from "@/setting-tab/layer.ts";
import { pdfReader } from "@/views/annot-view/pdf-reader.ts";
import {
  layerShowInLibrary,
  openLibraryView,
} from "@/views/library/register.ts";
import { layerShowInLibraryActions } from "@/views/library/show-in-library-actions.ts";
import { layerZoteroHttpNode } from "@/zotero-http-node.ts";

import { layerQueryCli } from "./item-query/cli.ts";
import { layerItemMatchQuery } from "./item-query/item-matches.ts";
import { layerQueryMeasureCli } from "./item-query/measure.ts";
import { layerQueryService } from "./item-query/service.ts";
import type { QueryService } from "./item-query/service.ts";
import { layerProtocolHandlers } from "./protocol/register.ts";
import type { ProtocolDeps } from "./protocol/register.ts";
import { layerReleaseActions } from "./release/actions.ts";
import { layerRelease } from "./release/service.ts";
import type { Release } from "./release/service.ts";
import { startingAs } from "./startup-failure.ts";
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
  | ItemMatchQuery
  | TemplateWorkbenchLauncher
  | ExcerptDisplays
  | ExcerptImageService
  | ExcerptPreparation
  | CitationText
  | CitationPopover
  | CitationIndex
  | BibliographyRender
  | CitationLookup
  | Profile
  | ProfileStyles
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
    // The Citation Template's actions and the Profile dialogs open a
    // document in the Template Workbench View through this port.
    layerTemplateWorkbenchLauncher.pipe(
      startingAs("TemplateWorkbenchLauncher"),
    ),
    // Profile selection and the Template Workbench test Profile Matches
    // through ZotLit Query.
    layerItemMatchQuery.pipe(
      startingAs("ItemMatchQuery"),
      Layer.provideMerge(
        layerQueryService({ pluginVersion: plugin.manifest.version }).pipe(
          startingAs("QueryService"),
        ),
      ),
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
    // The citations read the Profiles through their port.
    Layer.provideMerge(layerProfileStyles.pipe(startingAs("ProfileStyles"))),
    Layer.provideMerge(
      Layer.mergeAll(
        layerLibraryScope.pipe(startingAs("LibraryScope")),
        layerProfile(profileRevision).pipe(startingAs("Profile")),
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
        layerCitationParse(citationParseWorker).pipe(
          startingAs("CitationParse"),
        ),
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
      layerSettings(plugin).pipe(startingAs("PluginSettings")),
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
    layerCitekeyEditor.pipe(
      startingAs("CitekeyEditor"),
      Layer.provide(layerCitekeyNoteActions(creation)),
    ),
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
