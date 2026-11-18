// The layer of the Annotation Popover, which draws an Annotation above its
// Item's reference in the Citation Popover.
import { Effect, Layer } from "effect";

import { ExcerptDisplays } from "@zotlit/annotations/desktop/excerpt-image/display.ts";
import { createCommentRenderer } from "@zotlit/annotations/obsidian/annot-view/comment-render.ts";
import { AnnotationRepository } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import type {
  AnnotationLibraryUnresolved,
  AnnotationList,
  DatabaseRowsError,
} from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import { savedExcerptRequestOver } from "@zotlit/annotations/obsidian/excerpt-image/request.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { scopedBridge, valueOr } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import { formatIndexedKey } from "@zotlit/zotero-types/keys";

import { AnnotationPopoverCore } from "./popover.tsx";

import { AnnotationPopover } from "#obsidian/annotation-popover/service.ts";
import { CitationPopover } from "#obsidian/citation-popover/service.ts";

export const layerAnnotationPopover: Layer.Layer<
  AnnotationPopover,
  never,
  | AnnotationRepository
  | ExcerptDisplays
  | ZoteroReads
  | ZoteroPref
  | ObsidianApp
  | CitationPopover
> = Layer.effect(
  AnnotationPopover,
  Effect.gen(function* () {
    const repository = yield* AnnotationRepository;
    const excerptDisplay = yield* ExcerptDisplays;
    const reads = yield* ZoteroReads;
    const pref = yield* ZoteroPref;
    const app = yield* ObsidianApp;
    const citationPopover = yield* CitationPopover;
    const bridge = yield* scopedBridge;
    const core = yield* Effect.acquireDisposable(
      Effect.sync(
        () =>
          new AnnotationPopoverCore({
            annotations: repository,
            read: (attachmentKey) =>
              bridge
                .runPromiseExit(repository.read(attachmentKey))
                .then((exit) =>
                  valueOr<
                    AnnotationList | null | undefined,
                    AnnotationLibraryUnresolved | DatabaseRowsError
                  >(exit, undefined),
                ),
            bridge,
            excerptDisplay,
            excerptRequest: savedExcerptRequestOver({ reads, pref, bridge }),
            commentRenderer: (owner, sourcePath) =>
              createCommentRenderer({
                app,
                component: owner,
                getSourcePath: () => sourcePath,
              }),
          }),
      ),
    );
    return AnnotationPopover.of({
      show: (request) =>
        citationPopover.showWork({
          event: request.event,
          hoverParent: request.hoverParent,
          targetEl: request.targetEl,
          work: {
            kind: "annotation",
            annotationKey: formatIndexedKey(
              request.link.annotationKey,
              request.link.groupID,
            ),
          },
          open: request.open,
          // The core catches read failures.
          lead: (part) => {
            void core.follow(part, request);
          },
        }),
    });
  }).pipe(withLogCategory("annotation-popover")),
);
