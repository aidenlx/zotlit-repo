import { View } from "obsidian";
import type { Plugin } from "obsidian";
import semverGte from "semver/functions/gte";

import { addAttachmentOpenActions } from "@zotlit/annotations/desktop/attachment-open/actions.ts";
import { registerFileLinkCapture } from "@zotlit/annotations/desktop/attachment-open/capture.ts";
import { attachmentOpenFileMenu } from "@zotlit/annotations/desktop/attachment-open/menu.ts";
import { openTargetCommand } from "@zotlit/annotations/desktop/attachment-open/view-opener.ts";
import { createCommentRenderer } from "@zotlit/annotations/obsidian/annot-view/comment-render.ts";
import { addAnnotationHistoryActions } from "@zotlit/annotations/obsidian/annotation-repository/actions.ts";
import type { HistorySurface } from "@zotlit/annotations/obsidian/annotation-repository/actions.ts";
import { annotationHistoryFileMenu } from "@zotlit/annotations/obsidian/annotation-repository/menu.ts";
import {
  citationPresentationFileMenu,
  registerCitationPresentation,
} from "@zotlit/citations/desktop/citation-presentation/register.ts";
import { registerPandocExport } from "@zotlit/citations/desktop/pandoc-export/register.ts";
import { registerReferencesView } from "@zotlit/citations/desktop/references/register.ts";
import { registerCitationSuggest } from "@zotlit/citations/obsidian/citation-suggest/register.ts";
import { registerCitedByView } from "@zotlit/citations/obsidian/cited-by/register.ts";
import { addCitekeyEditorActions } from "@zotlit/citations/obsidian/citekey-editor/actions.ts";
import { addGraphCitationsActions } from "@zotlit/citations/obsidian/graph-citations/actions.ts";
import { itemActions } from "@zotlit/library-view/desktop/library/item-actions.ts";
import {
  registerLibraryView,
  showInLibrary,
} from "@zotlit/library-view/desktop/library/register.ts";
import { registerWelcomeView } from "@zotlit/library-view/desktop/library/welcome-register.ts";
import { registerQuickSwitch } from "@zotlit/library-view/desktop/quick-switch/register.ts";
import { createSetupActions } from "@zotlit/library-view/desktop/welcome/setup-actions.ts";
import { showInLibraryFileMenu } from "@zotlit/library-view/obsidian/library/show-in-library-actions.ts";
import {
  addNoteFeatureActions,
  noteFeatureFileMenu,
} from "@zotlit/notes/desktop/note-feature/actions.ts";
import { citationTemplateOf } from "@zotlit/notes/desktop/note-feature/citation-template.ts";
import {
  createProfileDialog,
  importProfileDialog,
} from "@zotlit/notes/desktop/profile/dialogs.ts";
import type { CliCommand, CliHost } from "@zotlit/obsidian-kit/cli-command.ts";
import {
  handlerCheckedFlags,
  printableCliHandler,
} from "@zotlit/obsidian-kit/cli-rejection.ts";
import { docsUrl } from "@zotlit/obsidian-kit/docs-url.ts";
import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { revealSetting } from "@zotlit/obsidian-kit/open-settings.ts";
import {
  ANNOTATION_SUGGESTER_ENABLED,
  WEB_WORKBENCH_ENABLED,
} from "@zotlit/plugin-kernel/constants.ts";
import { enableStartupLogging } from "@zotlit/plugin-kernel/log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { registerFileMenu } from "@zotlit/plugin-services/obsidian/file-menu.ts";
import { addIndexedKeyActions } from "@zotlit/plugin-services/obsidian/indexed-key/actions.ts";
import { indexedKeyFileMenu } from "@zotlit/plugin-services/obsidian/indexed-key/menu.ts";
import { startI18n } from "@zotlit/plugin-services/obsidian/language-pack/start.ts";
import { registerAnnotView } from "@zotlit/query-views/desktop/annot-view/register.ts";
import { AnnotationView } from "@zotlit/query-views/desktop/annot-view/view.tsx";
import { registerAnnotationSuggest } from "@zotlit/query-views/desktop/annotation-suggest/register.ts";
import { registerPdfNote } from "@zotlit/query-views/desktop/pdf-note/register.ts";
import { registerQueryBlock } from "@zotlit/query-views/desktop/query-view/block.ts";
import { QueryFileView } from "@zotlit/query-views/desktop/query-view/file-view.ts";
import { whenNear } from "@zotlit/query-views/desktop/query-view/note-host.ts";
import {
  queryFileFileMenu,
  queryFileFolderMenu,
  registerQueryFileView,
} from "@zotlit/query-views/desktop/query-view/register.ts";
import { literatureNotes } from "@zotlit/query-views/desktop/query-view/table-notes.ts";
import type { QueryViewDeps } from "@zotlit/query-views/desktop/query-view/view.tsx";
import { QueryCardFocus } from "@zotlit/query-views/obsidian/query-view/card-focus.ts";
import {
  explorerFileMenu,
  registerTemplateDataExplorer,
} from "@zotlit/template-workbench/desktop/data-explorer/register.ts";
import { registerWorkbenchSavedNotice } from "@zotlit/template-workbench/desktop/local-bridge/notices.ts";
import {
  templateWorkbenchFileMenu,
  registerTemplateWorkbenchView,
} from "@zotlit/template-workbench/desktop/view/register.ts";

import { logLateRelease, UnloadAwarePlugin } from "@/plugin-lifecycle.ts";

import { createPluginRuntime } from "./services/plugin-runtime.ts";
import { ServiceStartupFailed } from "./services/startup-failure.ts";
import "./zt-main.css";

function showInstallerUpdateNotice(): BaseNotice {
  return new BaseNotice(
    BaseNotice.render((renderer) => {
      renderer.setTitle(m.notice_installer_update_needed());
      renderer.addText(m.notice_installer_update_explanation());
      renderer.addSteps([
        m.notice_installer_update_step_download(),
        m.notice_installer_update_step_close(),
        m.notice_installer_update_step_run(),
      ]);
      renderer.addText(m.notice_installer_update_no_uninstall());
      renderer.addAction((button) => {
        button
          .setButtonText(m.notice_installer_update_learn_more())
          .onClick(() => {
            window.open(docsUrl("/docs/how-to/update-obsidian-installer"));
          });
      });
      renderer.addAction((button) => {
        button
          .setButtonText(m.notice_installer_update_download())
          .setCta()
          .onClick(() => {
            window.open("https://obsidian.md/download");
          });
      });
    }),
    0,
  );
}

/**
 * Block startup on Obsidian installers whose bundled Electron predates the
 * `minElectronVersion` declared in package.json (injected at build time as
 * `__MIN_ELECTRON_VERSION__`), pointing the user at the installer-update docs.
 *
 * @throws when the running Electron is too old, aborting plugin load.
 */
function assertElectronVersion(): void {
  const version = process.versions.electron;
  if (!version) return;
  if (semverGte(version, __MIN_ELECTRON_VERSION__)) return;

  showInstallerUpdateNotice();
  throw new Error(
    `Obsidian installer is too old (Electron v${version}, required >=v${__MIN_ELECTRON_VERSION__})`,
  );
}

/**
 * Stop plugin load on a service whose acquisition died, naming it on screen
 * and in the console. The onload stack releases what started as the error
 * leaves onload.
 *
 * @throws the startup failure, aborting plugin load.
 */
function reportStartupFailure(error: unknown): never {
  if (error instanceof ServiceStartupFailed) {
    new BaseNotice(
      BaseNotice.render((renderer) => {
        renderer.setTitle(m.notice_startup_failed());
        renderer.addText(
          m.notice_startup_failed_detail({ service: error.service }),
        );
      }),
      0,
    );
    console.error(`ZotLit: ${error.message}`, error.cause);
  }
  throw error;
}

/** Thin Obsidian plugin shell; feature work should live in services/actions. */
export default class ZotLitPlugin extends UnloadAwarePlugin implements CliHost {
  // Owns every service/resource registered during onload after startup commits.
  #stack?: AsyncDisposableStack;

  // Debug/escape-hatch access only. Services should depend on each other via DI.
  #services?: Awaited<ReturnType<typeof createPluginRuntime>>;

  /**
   * The plugin runtime's values, for `obsidian eval` callers outside the bundle —
   * `packages/e2e` and `packages/scripts` reach it through a string, so they
   * keep working while TypeScript sees nothing to navigate.
   *
   * Typed `unknown` on purpose: it stays unset until `onload()` commits, so
   * anything inside the bundle that reads a service through it gets a value
   * that throws at exactly the wrong moment. Take the service as an explicit
   * dependency instead.
   */
  get services(): unknown {
    if (!this.#services) throw new Error("Plugin not loaded");
    return this.#services;
  }

  /**
   * Every zotlit:* command registers here, so each handler rejects with the
   * text of its error: Obsidian prints any other rejection as [object Object].
   * Its decoder, not Obsidian, reports a missing parameter.
   */
  override registerCliHandler(
    ...[command, description, flags, handler]: Parameters<
      Plugin["registerCliHandler"]
    >
  ): void {
    super.registerCliHandler(
      command,
      description,
      handlerCheckedFlags(flags),
      printableCliHandler(handler),
    );
  }

  /**
   * Register a zotlit:* command whose handler is an Effect, run on the
   * plugin's runtime (`@zotlit/obsidian-kit/cli-command.ts`).
   */
  registerCliCommand(
    name: string,
    { description, flags, handler }: CliCommand,
  ): void {
    this.registerCliHandler(name, description, flags, (params) => {
      if (!this.#services) throw new Error("Plugin not loaded");
      return this.#services.runCli(handler(params));
    });
  }

  /** Show the installer notice independently of the version check. */
  showInstallerUpdateNotice(): BaseNotice {
    return showInstallerUpdateNotice();
  }

  override async onload(): Promise<void> {
    await super.onload();

    if (__DEV__) enableStartupLogging();

    // Install the current session's pack before any copy shows: the installer
    // and startup-failure notices below read `m.*` outside the service graph.
    // The graph's LanguagePack carries on from here and shows the consent
    // notice or the refresh toast once it builds.
    const languagePack = startI18n(this.app, this.manifest.version);

    // Block load on too-old Obsidian installers before allocating any resources.
    assertElectronVersion();

    // Local stack gives automatic rollback if any startup acquisition or wiring
    // fails before the plugin commits ownership with `stack.move()`.
    await using stack = new AsyncDisposableStack();

    // Start once the instance a quick off and on unloaded has released its
    // commands, zotlit:* names and port.
    const lateRelease = await this.waitForPreviousAndHoldRelease(stack);
    if (this.unloaded) return;

    const services = await createPluginRuntime(this, stack, languagePack).catch(
      reportStartupFailure,
    );
    // Logged now: the runtime's logging layer has given LogTape its sinks.
    if (lateRelease) logLateRelease(this.manifest.id);

    // A disable during the build has already unloaded this instance: leave
    // now, and the stack releases the services the build acquired.
    if (this.unloaded) return;

    addIndexedKeyActions(this);
    addCitekeyEditorActions(this, {
      citekeyEditor: services.citekeyEditor,
      bridge: services.bridge,
    });
    addGraphCitationsActions(this, {
      app: this.app,
      graphCitations: services.graphCitations,
      bridge: services.bridge,
    });
    const attachmentOpenDeps = {
      app: this.app,
      attachments: services.literatureNoteAttachments,
      opener: services.targetOpener,
      bridge: services.bridge,
    };
    addAttachmentOpenActions(this, attachmentOpenDeps);
    void stack.use(
      registerFileLinkCapture({
        opener: services.targetOpener,
        attachments: services.attachmentResolver,
        settings: services.settings,
        bridge: services.bridge,
      }),
    );
    const noteFeatureDeps = {
      app: this.app,
      noteActions: services.noteActions,
      importChildNotes: services.importChildNotes,
    };
    addNoteFeatureActions(this, noteFeatureDeps);
    stack.defer(
      registerWorkbenchSavedNotice({
        localBridge: services.localBridge,
        updateAll: () => services.noteActions.updateAll({ create: false }),
      }),
    );
    registerCitationSuggest(this, {
      app: this.app,
      lookup: services.itemLookup,
      citationTemplate: citationTemplateOf(services.noteFeature),
      settings: services.settings,
      bridge: services.bridge,
      ...services.citationSuggestServices,
    });
    if (ANNOTATION_SUGGESTER_ENABLED) {
      registerAnnotationSuggest(this, {
        app: this.app,
        workspace: this.app.workspace,
        query: services.query,
        bridge: services.bridge,
        runner: services.annotationInsertRunner,
        settings: services.settings,
        notify: (message) => void new BaseNotice(message),
        commentRenderer: (owner, sourcePath) =>
          createCommentRenderer({
            app: this.app,
            component: owner,
            getSourcePath: () => sourcePath,
          }),
      });
    }
    registerQuickSwitch(this, {
      app: this.app,
      attachments: services.literatureNoteAttachments,
      lookup: services.itemLookup,
      registry: services.viewRegistry,
      creation: {
        app: this.app,
        createProfile: (options) => createProfileDialog(this.app, options),
        importProfile: (options) => importProfileDialog(this.app, options),
      },
      settings: services.settings,
      bridge: services.bridge,
      opener: services.targetOpener,
      showInLibrary: (indexedKey) => showInLibrary(this.app, indexedKey),
    });

    const queryCardFocus = new QueryCardFocus(this.app);
    const queryViewDeps: QueryViewDeps = {
      registry: services.viewRegistry,
      runtime: services.runtime,
      app: this.app,
      cardFocus: queryCardFocus,
      nearScreen: whenNear,
      literatureNotes: literatureNotes({
        registry: services.viewRegistry,
        app: this.app,
        creation: {
          app: this.app,
          createProfile: (options) => createProfileDialog(this.app, options),
          importProfile: (options) => importProfileDialog(this.app, options),
        },
      }),
      opener: services.targetOpener,
    };
    // A view's open outlives the tab that started it: the reader may
    // replace that tab.
    stack.defer(queryViewDeps.registry.mount(openTargetCommand));
    registerAnnotView(this, {
      ...queryViewDeps,
      bridge: services.bridge,
      itemLookup: services.itemLookup,
      settings: services.settings,
      registry: services.viewRegistry,
      explorer: {
        bridge: services.bridge,
        context: services.workbenchActionContext,
      },
    });
    registerQueryFileView(this, queryViewDeps);
    registerQueryBlock(this, queryViewDeps);
    registerLibraryView(this, {
      ...queryViewDeps,
      welcome: {
        registry: services.viewRegistry,
        setupActions: createSetupActions({
          app: this.app,
          registry: services.viewRegistry,
          pluginId: this.manifest.id,
        }),
      },
      items: itemActions({
        creation: {
          app: this.app,
          createProfile: (options) => createProfileDialog(this.app, options),
          importProfile: (options) => importProfileDialog(this.app, options),
        },
        registry: services.viewRegistry,
        app: this.app,
        noteFeature: services.noteFeature,
        opener: services.targetOpener,
      }),
    });

    const pdfNoteFileMenu = registerPdfNote(this, {
      app: this.app,
      bridge: services.bridge,
      sessions: services.pdfAnnotationEditor.sessions,
      literatureNotes: queryViewDeps.literatureNotes,
      registry: services.viewRegistry,
      creation: {
        app: this.app,
        createProfile: (options) => createProfileDialog(this.app, options),
        importProfile: (options) => importProfileDialog(this.app, options),
      },
    });

    // The Annotation History's own verbs. A bound PDF view and an Annotation
    // View each step the Attachment they show, and a Query View the
    // Attachment of its focused card, so the palette acts on whichever of
    // them the user is in, and the menu on the leaf it was opened over.
    addAnnotationHistoryActions(this, {
      annotations: services.annotationRepository,
      bridge: services.bridge,
      activeSurface: (): HistorySurface | null => {
        const view = this.app.workspace.getActiveViewOfType(View);
        if (view instanceof AnnotationView) return view;
        if (view instanceof QueryFileView) return view.query;
        return (
          (view && queryCardFocus.surfaceIn(view.containerEl)) ??
          services.bridge.runSync(services.pdfAnnotationEditor.bindingFor(view))
        );
      },
    });

    const openCitationEngineSettings = () => {
      revealSetting(this.app, this.manifest.id, "settings_citation_engine");
    };
    const templateWorkbenchDeps = {
      registry: services.viewRegistry,
      bridge: services.bridge,
      context: services.workbenchActionContext,
      webWorkbenchEnabled: WEB_WORKBENCH_ENABLED,
      defaultProfile: services.defaultProfile,
      itemLookup: services.itemLookup,
      settings: services.settings,
      nativePreview: {
        app: this.app,
        registry: services.viewRegistry,
        openCitationEngineSettings,
      },
    };
    registerTemplateWorkbenchView(this, templateWorkbenchDeps);

    registerTemplateDataExplorer(this, {
      bridge: services.bridge,
      context: services.workbenchActionContext,
      app: this.app,
      registry: services.viewRegistry,
      itemLookup: services.itemLookup,
      settings: services.settings,
    });

    registerReferencesView(this, {
      app: this.app,
      registry: services.viewRegistry,
    });

    registerCitedByView(this, {
      app: this.app,
      registry: services.viewRegistry,
    });

    registerPandocExport(this, {
      app: this.app,
      context: services.pandocExportContext,
      bridge: services.bridge,
      openSettings: () => {
        this.app.setting.open();
        this.app.setting.openTabById(this.manifest.id);
      },
    });

    const citationPresentationDeps = {
      workspace: services.workspace,
      metadataCache: services.metadataCache,
      fileSystem: services.fileSystem,
      app: this.app,
      zoteroPref: services.zoteroPref,
      notifier: services.notifier,
      settings: services.settings,
      profiles: services.profileStyles,
      bridge: services.bridge,
    };
    registerCitationPresentation(this, citationPresentationDeps);

    // Every ZotLit entry on Obsidian's file menu. Each entry names its own
    // section; this order is the order of the rows inside each section.
    registerFileMenu(
      this,
      [
        attachmentOpenFileMenu(attachmentOpenDeps),
        pdfNoteFileMenu,
        templateWorkbenchFileMenu(this.app, templateWorkbenchDeps),
        noteFeatureFileMenu(noteFeatureDeps),
        citationPresentationFileMenu(citationPresentationDeps),
        annotationHistoryFileMenu({
          annotations: services.annotationRepository,
          bridge: services.bridge,
          surfaceFor: (leaf) =>
            services.bridge.runSync(
              services.pdfAnnotationEditor.bindingFor(leaf.view),
            ),
        }),
        indexedKeyFileMenu(),
        showInLibraryFileMenu((indexedKey) =>
          services.bridge.runAndForget(services.showInLibrary.show(indexedKey)),
        ),
        explorerFileMenu({
          bridge: services.bridge,
          context: services.workbenchActionContext,
        }),
        queryFileFileMenu(this.app),
      ],
      [queryFileFolderMenu(this.app)],
    );

    registerWelcomeView(this, {
      registry: services.viewRegistry,
    });

    // The companion's Freshness Signal means the database changed and its
    // Checkpoint attempt has settled; feed it into the same coalesced refresh
    // lane as the filesystem watchers.
    stack.defer(
      services.bridge.subscribe(services.localServer.dbUpdated, () => {
        services.bridge.runAndForget(services.zoteroReads.notifyExternalChange);
      }),
    );

    this.#services = services;
    this.#stack = stack.move();
  }

  override onunload(): void {
    // Start the last settings write now rather than at the end of disposal, so
    // an instance enabled straight after reads it; a view that saves as it
    // closes after this hands its write on the same way.
    if (this.#services)
      this.#services.bridge.runSync(this.#services.settings.release);
    // Drop the service bag before async disposal so late callers fail clearly.
    this.#services = undefined;

    const stack = this.#stack;
    this.#stack = undefined;

    void stack?.disposeAsync().catch((error: unknown) => {
      console.error("ZotLit cleanup error:", error);
      new BaseNotice("Failed to clean up ZotLit resources");
    });
  }
}
