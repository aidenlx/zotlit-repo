import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

import {
  ExcerptPicture,
  ExcerptText,
  excerptImageAlt,
  pageLocator,
} from "@zotlit/annotations/desktop/annot-view/excerpt-parts.tsx";
import type { ExcerptDisplayDemand } from "@zotlit/annotations/desktop/excerpt-image/display.ts";
import type { CommentRenderer } from "@zotlit/annotations/obsidian/annot-view/comment-render.ts";
import type { AnnotationRecord } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import { cn } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

export type AnnotationPopoverContentProps =
  | { kind: "unavailable" }
  | {
      kind: "annotation";
      annotation: AnnotationRecord;
      renderComment: CommentRenderer;
      excerpt: ExcerptDisplayDemand | null;
    };

const blockClass = "zt:flex zt:flex-col zt:gap-2 zt:px-3 zt:py-2";

export function AnnotationPopoverContent(props: AnnotationPopoverContentProps) {
  if (props.kind === "unavailable") {
    return (
      <div className={cn(blockClass, "zt:text-muted-foreground")} role="status">
        {m.annotation_popover_unavailable()}
      </div>
    );
  }
  const { annotation, renderComment, excerpt } = props;
  const { color, pageLabel, text, comment } = annotation;
  return (
    <div
      className={cn(
        blockClass,
        "zt:border-l-4",
        color ? "zt:border-(--zt-annot-color)" : "zt:border-border",
      )}
      style={color ? ({ "--zt-annot-color": color } as CSSProperties) : {}}
      data-annotation-key={annotation.key}
    >
      {pageLabel !== null && (
        <span
          className={cn(
            "zt:self-start zt:rounded-sm zt:px-1 zt:font-mono zt:text-xs zt:font-medium zt:tracking-tight zt:tabular-nums",
            color
              ? "zt:bg-(--zt-annot-color)/22 zt:text-foreground"
              : "zt:text-muted-foreground",
          )}
        >
          {pageLocator(pageLabel)}
        </span>
      )}
      {excerpt && (
        <ExcerptPicture
          demand={excerpt}
          identity={annotation.key}
          alt={excerptImageAlt(annotation)}
          className="zt:max-h-60 zt:max-w-full zt:self-start zt:ring-1 zt:ring-foreground/10 zt:ring-inset"
        />
      )}
      {text && <ExcerptText text={text} className="zt:m-0" />}
      {comment && <Comment html={comment} render={renderComment} />}
    </div>
  );
}

function Comment({ html, render }: { html: string; render: CommentRenderer }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return render(ref.current, html);
  }, [html, render]);
  return <div ref={ref} className="zt:text-muted-foreground zt:select-text" />;
}
