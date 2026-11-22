import type { AnnotationHoverRequest } from "#obsidian/annotation-popover/service.ts";
import type { PopoverPart } from "#obsidian/citation-popover/visits.ts";
import { Effect } from "effect";
import type { Component } from "obsidian";

import type {
  ExcerptDisplayDemand,
  ExcerptDisplays,
} from "@zotlit/annotations/desktop/excerpt-image/display.ts";
import type { CommentRenderer } from "@zotlit/annotations/obsidian/annot-view/comment-render.ts";
import type {
  AnnotationList,
  AnnotationRecord,
  AnnotationRepository,
  AnnotationSource,
} from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import type { ExcerptRequest } from "@zotlit/annotations/obsidian/excerpt-image/service.ts";
import { AbortError } from "@zotlit/plugin-kernel/abort-error.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { formatIndexedKey } from "@zotlit/zotero-types/keys";

import { AnnotationPopoverContent } from "./content.tsx";

export interface AnnotationPopoverCoreDeps {
  annotations: Pick<
    AnnotationRepository["Service"],
    "hold" | "annotationsChanged"
  >;
  read: (attachmentKey: string) => Promise<AnnotationList | null | undefined>;
  bridge: Pick<EffectBridge, "runSync" | "subscribe">;
  excerptDisplay: Pick<ExcerptDisplays["Service"], "open">;
  excerptRequest: (input: {
    annotation: AnnotationRecord;
    source: AnnotationSource;
  }) => Promise<ExcerptRequest | null>;
  commentRenderer: (owner: Component, sourcePath: string) => CommentRenderer;
}

export class AnnotationPopoverCore implements Disposable {
  readonly #deps;
  #closed = false;

  constructor(deps: AnnotationPopoverCoreDeps) {
    this.#deps = deps;
  }

  [Symbol.dispose](): void {
    this.#closed = true;
  }

  follow(
    part: PopoverPart,
    { sourcePath, link }: Pick<AnnotationHoverRequest, "sourcePath" | "link">,
  ): Promise<void> {
    if (this.#closed) return Promise.resolve();
    const deps = this.#deps;
    const { owner, subscriptions } = part;
    const attachmentKey = formatIndexedKey(link.attachmentKey, link.groupID);
    const annotationKey = formatIndexedKey(link.annotationKey, link.groupID);
    const renderComment = deps.commentRenderer(owner, sourcePath);
    let generation = 0;
    subscriptions.defer(() => generation++);
    let excerpt: ExcerptDisplayDemand | null = null;
    let drawn = false;

    subscriptions.use(
      deps.bridge.runSync(deps.annotations.hold([attachmentKey])),
    );
    const draw = (): Promise<void> => {
      const read = ++generation;
      const current = (): boolean => generation === read;
      return deps
        .read(attachmentKey)
        .then((list) => {
          if (list === undefined || !current()) return;
          if (list === null && drawn) return;
          const annotation =
            list?.annotations.find(({ key }) => key === annotationKey) ?? null;
          drawn = true;
          if (annotation === null) {
            deps.bridge.runSync(
              Effect.logDebug(
                "Hovered annotation link names no annotation",
              ).pipe(
                Effect.annotateLogs({
                  attachmentKey,
                  annotationKey,
                }),
                withLogCategory("annotation-popover"),
              ),
            );
            part.draw(<AnnotationPopoverContent kind="unavailable" />);
            return;
          }
          if (list !== null && hasExcerptImage(annotation)) {
            if (excerpt === null) {
              const opened = deps.bridge.runSync(deps.excerptDisplay.open);
              subscriptions.defer(() => opened.release());
              excerpt = opened;
            }
            const demand = excerpt;
            void deps
              .excerptRequest({ annotation, source: list.source })
              .then((request) => {
                if (current()) demand.demand(request);
              });
          }
          const shown = part.draw(
            <AnnotationPopoverContent
              kind="annotation"
              annotation={annotation}
              renderComment={renderComment}
              excerpt={excerpt}
            />,
          );
          deps.bridge.runSync(
            Effect.logDebug("Annotation popover drawn").pipe(
              Effect.annotateLogs({
                annotationKey,
                type: annotation.type,
                shown,
              }),
              withLogCategory("annotation-popover"),
            ),
          );
        })
        .catch((error: unknown) => {
          if (!current() || AbortError.test(error)) return;
          deps.bridge.runSync(
            Effect.logWarning(
              "Cannot read the annotations of a hovered link",
            ).pipe(
              Effect.annotateLogs({
                attachmentKey,
                error,
              }),
              withLogCategory("annotation-popover"),
            ),
          );
          part.draw(<AnnotationPopoverContent kind="unavailable" />);
        });
    };
    subscriptions.defer(
      deps.bridge.subscribe(deps.annotations.annotationsChanged, (changed) => {
        if (changed === attachmentKey) void draw();
      }),
    );
    return draw();
  }
}

function hasExcerptImage(annotation: AnnotationRecord): boolean {
  return annotation.type === "image" || annotation.type === "ink";
}
