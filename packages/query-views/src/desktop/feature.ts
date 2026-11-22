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
import { ZotlitPdfReader } from "@zotlit/annotations/obsidian/pdf-reader/service.ts";
import { ItemMatchQuery } from "@zotlit/notes/core/profile-selection/item-matches.ts";
import { interactiveCreation } from "@zotlit/notes/desktop/profile/dialogs.ts";
import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
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
  extendFeature,
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

import { queryViews as obsidianQueryViews } from "#obsidian/feature.ts";
import { QueryCardFocus } from "#obsidian/query-view/card-focus.ts";

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

export const queryViews = extendFeature(obsidianQueryViews, {
  services: [
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
    serviceGroup(
      "PdfTargetReader",
      { provides: [PdfTargetReader], requires: [ZotlitPdfReader, Vault] },
      Layer.effect(PdfTargetReader, pdfReader),
    ),
  ],
  registrations: [
    registration("QueryCli", layerQueryCli),
    ...(__DEV__ ? [registration("QueryMeasureCli", layerQueryMeasureCli)] : []),
  ],
  handles: (ctx) => {
    const { bridge, runtime, read } = ctx;
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
