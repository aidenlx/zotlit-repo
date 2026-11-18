import { Effect, FiberSet, FileSystem, Layer, Scope } from "effect";
import { View } from "obsidian";

import {
  PdfTargetReader,
  TargetOpener,
} from "@zotlit/annotations/desktop/attachment-open/open-target.ts";
import { createCommentRenderer } from "@zotlit/annotations/obsidian/annot-view/comment-render.ts";
import type { InsertRunner } from "@zotlit/annotations/obsidian/annot-view/insert-run.ts";
import { AnnotationNoteActions } from "@zotlit/annotations/obsidian/annot-view/note-actions.ts";
import { AnnotationViewReveal } from "@zotlit/annotations/obsidian/annot-view/view-reveal.ts";
import { addAnnotationHistoryActions } from "@zotlit/annotations/obsidian/annotation-repository/actions.ts";
import type { HistorySurface } from "@zotlit/annotations/obsidian/annotation-repository/actions.ts";
import { AnnotationRepository } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import { PdfAnnotationEditor } from "@zotlit/annotations/obsidian/pdf-annotation-editor/service.ts";
// ZotLit Query in Obsidian as one feature a host composes: the Item Query
// adapter, the Query View and the sidebar Annotation View, the Annotation
// Suggester and the PDF view's note button, and the ports of the annotations
// and the notes they fill.
import { ItemMatchQuery } from "@zotlit/notes/core/profile-selection/item-matches.ts";
import { interactiveCreation } from "@zotlit/notes/desktop/profile/dialogs.ts";
import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { ViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import { ANNOTATION_SUGGESTER_ENABLED } from "@zotlit/plugin-kernel/constants.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { bindItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/handle.ts";
import { ItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import {
  defineFeature,
  registration,
  serviceGroup,
} from "@zotlit/plugin-shell/obsidian/feature.ts";
import type { FeatureContext } from "@zotlit/plugin-shell/obsidian/feature.ts";
import { workbenchActionsOf } from "@zotlit/template-workbench/desktop/feature.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { pdfReader } from "./annot-view/pdf-reader.ts";
import {
  annotationCardShown,
  registerAnnotView,
  revealAnnotationInView,
} from "./annot-view/register.ts";
import { AnnotationView } from "./annot-view/view.tsx";
import { registerAnnotationSuggest } from "./annotation-suggest/register.ts";
import { layerQueryCli } from "./item-query/cli.ts";
import { bindQuery } from "./item-query/handle.ts";
import { layerItemMatchQuery } from "./item-query/item-matches.ts";
import { layerQueryMeasureCli } from "./item-query/measure.ts";
import { layerQueryService, QueryService } from "./item-query/service.ts";
import { registerPdfNote } from "./pdf-note/register.ts";
import { registerQueryBlock } from "./query-view/block.ts";
import { QueryFileView } from "./query-view/file-view.ts";
import { whenNear } from "./query-view/note-host.ts";
import {
  queryFileFileMenu,
  queryFileFolderMenu,
  registerQueryFileView,
} from "./query-view/register.ts";
import { literatureNotes } from "./query-view/table-notes.ts";
import type { QueryViewDeps } from "./query-view/view.tsx";

import { QueryCardFocus } from "#obsidian/query-view/card-focus.ts";

/**
 * What every Query View host reads: the card focus and the Literature Notes
 * of the Table, one of each for the plugin, so the Annotation History finds
 * the focused card in any of them.
 */
function queryViewDeps(
  ctx: FeatureContext,
): QueryViewDeps & { readonly cardFocus: QueryCardFocus } {
  const { app, runtime, read } = ctx;
  const registry = read(ViewRegistry);
  const creation = interactiveCreation(app);
  return {
    registry,
    runtime,
    app,
    cardFocus: new QueryCardFocus(app),
    nearScreen: whenNear,
    literatureNotes: literatureNotes({ registry, app, creation }),
    opener: read(TargetOpener),
  };
}

export const queryViews = defineFeature({
  name: "query views",
  services: [
    // Profile selection and the Template Workbench test Profile Matches
    // through ZotLit Query.
    serviceGroup(
      "QueryService",
      {
        provides: [QueryService],
        requires: [
          FileSystem.FileSystem,
          LibraryScope,
          UseLedger,
          ZoteroPref,
          ZoteroReads,
        ],
      },
      Layer.unwrap(
        Effect.map(PluginHost, (host) =>
          layerQueryService({ pluginVersion: host.manifest.version }),
        ),
      ),
    ),
    serviceGroup(
      "ItemMatchQuery",
      { provides: [ItemMatchQuery], requires: [QueryService] },
      layerItemMatchQuery,
    ),
    // The capability notices and the PDF reader's marks bring a card
    // forward in the Annotation View.
    serviceGroup(
      "AnnotationViewReveal",
      { provides: [AnnotationViewReveal] },
      Layer.unwrap(
        Effect.map(PluginHost, (host) =>
          Layer.succeed(AnnotationViewReveal, {
            cardShown: (annotationKey) =>
              annotationCardShown(host.app, annotationKey),
            revealAnnotation: (annotationKey) =>
              void revealAnnotationInView(host, annotationKey),
          }),
        ),
      ),
    ),
    // A Target Opener's PDF opens bring the Annotation View forward beside it.
    serviceGroup(
      "PdfTargetReader",
      { provides: [PdfTargetReader] },
      Layer.effect(PdfTargetReader, pdfReader),
    ),
  ],
  registrations: [
    registration("QueryCli", layerQueryCli),
    // Measurement-only: lets packages/e2e/src/query-measure.ts read the
    // slices, statements, heap, and cancel times of a run. A dev-build port,
    // never registered in a production build.
    ...(__DEV__ ? [registration("QueryMeasureCli", layerQueryMeasureCli)] : []),
  ],
  handles: (ctx) => {
    const { bridge, runtime, read } = ctx;
    // The Annotation Suggester belongs to the plugin, not a view: its inserts
    // fork on the runtime's Scope, so unload interrupts each one still running.
    const annotationNotes = read(AnnotationNoteActions);
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
      query: bindQuery(bridge, read(QueryService)),
      annotationInsertRunner,
      queryViewDeps: queryViewDeps(ctx),
    };
  },
  onload: (ctx) => {
    const { plugin, app, bridge, read } = ctx;
    const {
      query,
      annotationInsertRunner,
      queryViewDeps: deps,
    } = ctx.handlesOf(queryViews);
    const settings = read(PluginSettings);
    const itemLookup = bindItemLookup(bridge, read(ItemLookup));
    if (ANNOTATION_SUGGESTER_ENABLED) {
      registerAnnotationSuggest(plugin, {
        app,
        workspace: app.workspace,
        query,
        bridge,
        runner: annotationInsertRunner,
        settings,
        notify: (message) => void new BaseNotice(message),
        commentRenderer: (owner, sourcePath) =>
          createCommentRenderer({
            app,
            component: owner,
            getSourcePath: () => sourcePath,
          }),
      });
    }
    registerAnnotView(plugin, {
      ...deps,
      bridge,
      itemLookup,
      settings,
      explorer: workbenchActionsOf(ctx),
    });
    registerQueryFileView(plugin, deps);
    registerQueryBlock(plugin, deps);
    const pdfAnnotationEditor = read(PdfAnnotationEditor);
    const pdfNoteFileMenu = registerPdfNote(plugin, {
      app,
      bridge,
      sessions: pdfAnnotationEditor.sessions,
      literatureNotes: deps.literatureNotes,
      registry: deps.registry,
      creation: interactiveCreation(app),
    });
    // The Annotation History's own verbs. A bound PDF view and an Annotation
    // View each step the Attachment they show, and a Query View the
    // Attachment of its focused card, so the palette acts on whichever of
    // them the user is in. This feature names the views, so it registers them.
    addAnnotationHistoryActions(plugin, {
      annotations: read(AnnotationRepository),
      bridge,
      activeSurface: (): HistorySurface | null => {
        const view = app.workspace.getActiveViewOfType(View);
        if (view instanceof AnnotationView) return view;
        if (view instanceof QueryFileView) return view.query;
        return (
          (view && deps.cardFocus.surfaceIn(view.containerEl)) ??
          bridge.runSync(pdfAnnotationEditor.bindingFor(view))
        );
      },
    });
    return {
      fileMenu: {
        "pdf-note": pdfNoteFileMenu,
        "query-file": queryFileFileMenu(app),
      },
      folderMenu: { "query-file": queryFileFolderMenu(app) },
    };
  },
});
