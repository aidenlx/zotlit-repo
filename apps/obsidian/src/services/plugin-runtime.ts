// Composes the plugin's Effect runtime and binds the services the plugin shell and debug surface read.
import { Effect, FiberSet, FileSystem, Scope } from "effect";

import { TargetOpener } from "@zotlit/annotations/desktop/attachment-open/open-target.ts";
import { ExcerptDisplays } from "@zotlit/annotations/desktop/excerpt-image/display.ts";
import { blockedNotice } from "@zotlit/annotations/obsidian/annot-view/card-verbs.ts";
import type { InsertRunner } from "@zotlit/annotations/obsidian/annot-view/insert-run.ts";
import { AnnotationNoteActions } from "@zotlit/annotations/obsidian/annot-view/note-actions.ts";
import { bindCapabilityNotices } from "@zotlit/annotations/obsidian/annotation-repository/notices-handle.ts";
import { CapabilityNotices } from "@zotlit/annotations/obsidian/annotation-repository/notices.ts";
import { AnnotationRepository } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import { bindLiteratureNoteAttachments } from "@zotlit/annotations/obsidian/attachment-open/handle.ts";
import type { LiteratureNoteServices } from "@zotlit/annotations/obsidian/attachment-open/literature-note.ts";
import type { ExcerptReaderDocuments } from "@zotlit/annotations/obsidian/excerpt-image/reader-borrow.ts";
import { ExcerptImageService } from "@zotlit/annotations/obsidian/excerpt-image/service.ts";
import { openExcerptStore } from "@zotlit/annotations/obsidian/excerpt-image/store.ts";
import { PdfAnnotationEditor } from "@zotlit/annotations/obsidian/pdf-annotation-editor/service.ts";
import type { PandocExportServices } from "@zotlit/citations/desktop/pandoc-export/register.ts";
import { AnnotationPopover } from "@zotlit/citations/obsidian/annotation-popover/service.ts";
import { CitationLookup } from "@zotlit/citations/obsidian/citation-index/lookup-service.ts";
import { CitationIndex } from "@zotlit/citations/obsidian/citation-index/service.ts";
import { CitationPopover } from "@zotlit/citations/obsidian/citation-popover/service.ts";
import { CitationText } from "@zotlit/citations/obsidian/citation-text/service.ts";
import { CitekeyEditor } from "@zotlit/citations/obsidian/citekey-editor/service.ts";
import { GraphCitations } from "@zotlit/citations/obsidian/graph-citations/service.ts";
import { ProfileStyles } from "@zotlit/citations/obsidian/pandoc/profile-styles.ts";
import { PandocEngine } from "@zotlit/citations/obsidian/pandoc/service.ts";
import { openWelcomeView } from "@zotlit/library-view/desktop/library/welcome-register.ts";
import { Release } from "@zotlit/library-view/obsidian/release/service.ts";
import { bindNoteActions } from "@zotlit/notes/desktop/note-feature/actions-handle.ts";
import type { NoteActionServices } from "@zotlit/notes/desktop/note-feature/actions-view.ts";
import { bindNoteCitations } from "@zotlit/notes/desktop/note-feature/citations-handle.ts";
import type { NoteCitationServices } from "@zotlit/notes/desktop/note-feature/citations-handle.ts";
import { bindNoteCreation } from "@zotlit/notes/desktop/note-feature/creation-handle.ts";
import type { NoteCreationServices } from "@zotlit/notes/desktop/note-feature/creation-handle.ts";
import type { InteractiveCreationPorts } from "@zotlit/notes/desktop/note-feature/creation-view.ts";
import {
  bindNoteFeature,
  NoteFeature,
} from "@zotlit/notes/desktop/note-feature/index.ts";
import type { NoteFeatureHandle } from "@zotlit/notes/desktop/note-feature/index.ts";
import { batchUpdateNotices } from "@zotlit/notes/desktop/note-feature/update-single.ts";
import { bindBatchImport } from "@zotlit/notes/desktop/note-import/batch-import-handle.ts";
import type { BatchImportServices } from "@zotlit/notes/desktop/note-import/batch-import.ts";
import {
  importChildNotes,
  importStarter,
} from "@zotlit/notes/desktop/note-import/commands.ts";
import { createNoteImportView } from "@zotlit/notes/desktop/note-import/view.ts";
import {
  createProfileDialog,
  importProfileDialog,
} from "@zotlit/notes/desktop/profile/dialogs.ts";
import { bindTemplateData } from "@zotlit/notes/desktop/template/data-handle.ts";
import type { TemplateDataServices } from "@zotlit/notes/desktop/template/data.ts";
import type { TemplateMigrationOptions } from "@zotlit/notes/desktop/template/migration.ts";
import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { Template } from "@zotlit/notes/obsidian/template/service.ts";
import { cliRunner } from "@zotlit/obsidian-kit/cli-command.ts";
import { DisposableAbortController } from "@zotlit/obsidian-kit/disposables.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { revealSetting } from "@zotlit/obsidian-kit/open-settings.ts";
import { ShowInLibrary } from "@zotlit/obsidian-kit/show-in-library.ts";
import { ViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import { WEB_WORKBENCH_ENABLED } from "@zotlit/plugin-kernel/constants.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { AttachmentResolver } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";
import { ChineseSegmenter } from "@zotlit/plugin-services/obsidian/chinese-segmenter/service.ts";
import { libraryTagNamesOf } from "@zotlit/plugin-services/obsidian/database/library-tag-names.ts";
import { bindItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/handle.ts";
import { ItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import type { LanguagePackStartup } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { bindManagedBinary } from "@zotlit/plugin-services/obsidian/managed-binary/handle.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { ZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";
import {
  annotationCardShown,
  revealAnnotationInView,
} from "@zotlit/query-views/desktop/annot-view/register.ts";
import { bindQuery } from "@zotlit/query-views/desktop/item-query/handle.ts";
import { QueryService } from "@zotlit/query-views/desktop/item-query/service.ts";
import type { WorkbenchActionServices } from "@zotlit/template-workbench/desktop/editor/actions.ts";
import type { DefaultProfileTarget } from "@zotlit/template-workbench/desktop/local-bridge/customize.ts";
import { bindLocalBridge } from "@zotlit/template-workbench/desktop/local-bridge/handle.ts";
import { createLaunchSheet } from "@zotlit/template-workbench/desktop/local-bridge/launch-sheet.ts";
import { LocalBridge } from "@zotlit/template-workbench/desktop/local-bridge/service.ts";
import { openTemplateWorkbench } from "@zotlit/template-workbench/desktop/view/open.ts";
import {
  profileCustomization,
  saveProfileCustomization,
} from "@zotlit/template-workbench/obsidian/local-bridge/preferences.ts";
import { acquireReadLease } from "@zotlit/zotero-reads/client/lease.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import type ZotLitPlugin from "@/zt-main.ts";

import { pluginLayer } from "./plugin-layer.ts";
import type { ProtocolDeps } from "./protocol/register.ts";

/** What the protocol handlers open: the note import's modals. */
type ProtocolViews = Pick<ProtocolDeps, "noteImportView">;

/**
 * Compose the plugin's runtime over {@link pluginLayer} and bind the values
 * the plugin shell and the debug surface read.
 *
 * This function does not own lifecycle. `zt-main.ts` creates the stack, passes
 * it here, and moves the stack only after all plugin startup wiring succeeds.
 * Two entries go on `stack`: the runtime's disposal, before acquisition
 * starts, and then the CLI runner's abort. Everything the shell registers
 * after this sits above both, so unload runs the shell's cleanup first, then
 * interrupts a running command, and closes the graph last.
 *
 * The runtime finishes acquisition first, including each layer's
 * asynchronous first load, so every value read here has finished acquiring.
 * A throw anywhere in here leaves the graph on `stack` for the caller's
 * rollback.
 */
export async function createPluginRuntime(
  plugin: ZotLitPlugin,
  stack: AsyncDisposableStack,
  languagePack: LanguagePackStartup,
) {
  let bindMigration!: (
    actions: Pick<TemplateMigrationOptions, "openPrompt">,
  ) => void;
  const migrationActions = new Promise<
    Pick<TemplateMigrationOptions, "openPrompt">
  >((resolve) => {
    bindMigration = resolve;
  });
  // The note creation opens the setting tab's Profile dialogs, which run in
  // the caller's fiber with the caller's services.
  const creation: InteractiveCreationPorts = {
    app: plugin.app,
    createProfile: (options) => createProfileDialog(plugin.app, options),
    importProfile: (options) => importProfileDialog(plugin.app, options),
  };
  // The protocol handlers open the note import's modals, which are built
  // after the graph.
  let bindProtocolViews!: (views: ProtocolViews) => void;
  const protocolViews = new Promise<ProtocolViews>((resolve) => {
    bindProtocolViews = resolve;
  });
  const importView = Effect.promise(async () => {
    const { noteImportView } = await protocolViews;
    return noteImportView;
  });
  const protocol: ProtocolViews = {
    noteImportView: {
      openBatchModal: (options) => {
        void protocolViews.then(({ noteImportView }) =>
          noteImportView.openBatchModal(options),
        );
      },
      confirm: (options) =>
        Effect.flatMap(importView, (view) => view.confirm(options)),
      chooseProfile: (options) =>
        Effect.flatMap(importView, (view) => view.chooseProfile(options)),
    },
  };
  // The excerpt service is registered before the PDF reader, so the reader
  // hands its documents over through this one holder. A crop asks for a reader
  // document per resolution, and answers detached while the holder is empty.
  const readers: ExcerptReaderDocuments = { borrow: () => null };
  const runtime = buildRuntime(
    pluginLayer(
      plugin,
      {
        openPrompt: async () => (await migrationActions).openPrompt(),
      },
      {
        capabilityNotices: {
          openEditingSettings: () =>
            revealSetting(
              plugin.app,
              plugin.manifest.id,
              "settings_zotero_editing",
            ),
          cardShown: (annotationKey) =>
            annotationCardShown(plugin.app, annotationKey),
          revealAnnotation: (annotationKey) =>
            void revealAnnotationInView(plugin, annotationKey),
        },
        creation,
        customize: {
          webWorkbenchEnabled: WEB_WORKBENCH_ENABLED,
          pluginVersion: plugin.manifest.version,
          confirmLaunch: createLaunchSheet(plugin.app),
          openExternal: (url) => window.open(url),
          preference: () => profileCustomization(plugin.app),
          rememberPreference: (value) =>
            saveProfileCustomization(plugin.app, value),
          openNative: ({ item, originatingNote }, target) =>
            openTemplateWorkbench(target, {
              ...(item ? { itemIndexedKey: item.key } : {}),
              originatingNote,
              explainUnsupported: false,
              customize: true,
            }),
        },
        protocol,
        pdfEditor: {
          revealAnnotation: (key) => void revealAnnotationInView(plugin, key),
          blockedPress: blockedNotice,
          readers,
        },
        excerpt: {
          openStore: () => openExcerptStore(plugin.app.appId),
          readers,
        },
        languagePack,
      },
    ),
    stack,
  );
  await runtime.context();
  bindMigration({ openPrompt: () => openWelcomeView(plugin.app) });
  const bridge = effectBridge(runtime);
  // Above the runtime on the stack, so unload interrupts a command still
  // running before the services it reads dispose.
  const runCli = cliRunner(
    bridge,
    stack.use(new DisposableAbortController()).signal,
  );

  const settings = runtime.runSync(PluginSettings);
  const zoteroReads = runtime.runSync(ZoteroReads);
  const attachmentResolver = runtime.runSync(AttachmentResolver);
  const citationLookup = runtime.runSync(CitationLookup);
  const citationIndex = runtime.runSync(CitationIndex);
  const useLedger = runtime.runSync(UseLedger);
  const zoteroPref = runtime.runSync(ZoteroPref);
  const notifier = runtime.runSync(Notifier);
  const pandocEngine = runtime.runSync(PandocEngine);
  const profile = runtime.runSync(Profile);
  const noteFeature: NoteFeatureHandle = bindNoteFeature(
    bridge,
    runtime.runSync(NoteFeature),
    {
      ...bindNoteCitations(
        bridge,
        runtime.runSync(Effect.context<NoteCitationServices>()),
      ),
      ...bindNoteCreation(
        bridge,
        runtime.runSync(Effect.context<NoteCreationServices>()),
        creation,
      ),
    },
  );
  const noteImportView = createNoteImportView(plugin.app, creation);
  // Import child notes on the file menu, as the command runs it.
  const startImport = importStarter(
    bridge,
    runtime.runSync(Effect.context<BatchImportServices | Notifier>()),
  );
  const importChildNotesOf = (indexedKey: string) =>
    startImport(
      importChildNotes(
        { view: noteImportView, bridge },
        plugin.app,
        indexedKey,
      ),
    );
  bindProtocolViews({ noteImportView });
  // The Annotation Suggester belongs to the plugin, not a view: its inserts
  // fork on the runtime's Scope, so unload interrupts each one still running.
  const annotationNotes = runtime.runSync(AnnotationNoteActions);
  const annotationInsertRunner: InsertRunner<never> = {
    execute: (request) => annotationNotes.insert(request),
    run: runtime.runSync(
      FiberSet.make().pipe(
        Effect.flatMap((fibers) => FiberSet.runtime(fibers)<never>()),
        Scope.provide(runtime.scope),
      ),
    ),
  };

  return {
    runtime,
    bridge,
    viewRegistry: runtime.runSync(ViewRegistry),
    annotationInsertRunner,
    workspace: runtime.runSync(Workspace),
    metadataCache: runtime.runSync(MetadataCache),
    notifier,
    zoteroPref,
    showInLibrary: runtime.runSync(ShowInLibrary),
    fileSystem: runtime.runSync(FileSystem.FileSystem),
    settings,
    useLedger,
    runCli,
    queryClient: runtime.runSync(QueryClients),
    release: runtime.runSync(Release),
    template: runtime.runSync(Template),
    noteIndex: runtime.runSync(NoteIndex),
    localServer: runtime.runSync(LocalServer),
    chineseSegmenter: bindManagedBinary(
      bridge,
      runtime.runSync(ChineseSegmenter),
    ),
    zoteroReads,
    acquireZoteroRead: () => acquireReadLease(zoteroReads, bridge),
    libraryTagNames: libraryTagNamesOf(zoteroReads, bridge),
    excerptImage: runtime.runSync(ExcerptImageService),
    excerptDisplay: runtime.runSync(ExcerptDisplays),
    attachmentResolver,
    targetOpener: runtime.runSync(TargetOpener),
    literatureNoteAttachments: bindLiteratureNoteAttachments(
      bridge,
      runtime.runSync(Effect.context<LiteratureNoteServices>()),
    ),
    zoteroLocalApi: runtime.runSync(ZoteroLocalApi),
    annotationRepository: runtime.runSync(AnnotationRepository),
    capabilityNotices: bindCapabilityNotices(
      bridge,
      runtime.runSync(CapabilityNotices),
    ),
    pdfAnnotationEditor: runtime.runSync(PdfAnnotationEditor),
    libraryScope: runtime.runSync(LibraryScope),
    query: bindQuery(bridge, runtime.runSync(QueryService)),
    profile,
    // The Default Profile, as the Template Workbench opens it from a note.
    defaultProfile: {
      get defaultDocumentPath() {
        return bridge.runSync(profile.defaultDocumentPath);
      },
    } satisfies DefaultProfileTarget,
    localBridge: bindLocalBridge(bridge, runtime.runSync(LocalBridge)),
    templateData: bindTemplateData(
      bridge,
      runtime.runSync(Effect.context<TemplateDataServices>()),
    ),
    itemLookup: bindItemLookup(bridge, runtime.runSync(ItemLookup)),
    noteFeature,
    importChildNotes: importChildNotesOf,
    noteImportView,
    batchImport: bindBatchImport(
      bridge,
      runtime.runSync(Effect.context<BatchImportServices>()),
      { view: noteImportView },
    ),
    noteActions: bindNoteActions(
      bridge,
      runtime.runSync(Effect.context<NoteActionServices>()),
      {
        creation,
        view: noteImportView,
        notices: batchUpdateNotices(plugin.app),
      },
    ),
    citationLookup,
    citationIndex,
    citationSuggestServices: { citationLookup, citationIndex, useLedger },
    pandocExportContext: runtime.runSync(
      Effect.context<PandocExportServices>(),
    ),
    workbenchActionContext: runtime.runSync(
      Effect.context<WorkbenchActionServices>(),
    ),
    pandocEngine: bindManagedBinary(bridge, pandocEngine),
    citationText: runtime.runSync(CitationText),
    profileStyles: runtime.runSync(ProfileStyles),
    citationPopover: runtime.runSync(CitationPopover),
    annotationPopover: runtime.runSync(AnnotationPopover),
    citekeyEditor: runtime.runSync(CitekeyEditor),
    graphCitations: runtime.runSync(GraphCitations),
  };
}
