import type { ExcerptImage } from "#core/excerpt-image/format.ts";
import type { ExcerptDisplayDemand } from "#desktop/excerpt-image/display.ts";
import type { AnnotationRecord } from "#obsidian/annotation-repository/service.ts";
import { sanitizeHTMLToDom } from "obsidian";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { isPageNumber } from "@zotlit/db";
import { cn } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { excerptImageOwnership } from "./excerpt-image-state.ts";
import type { ExcerptImageOwnership } from "./excerpt-image-state.ts";

import { useSanitizedHtml } from "#obsidian/annot-view/sanitize-html.ts";

export function pageLocator(pageLabel: string): string {
  return isPageNumber(pageLabel)
    ? m.annot_view_page({ page: pageLabel })
    : pageLabel;
}

export function excerptImageAlt(
  annotation: Pick<AnnotationRecord, "text" | "pageLabel">,
): string {
  const { text, pageLabel } = annotation;
  if (text) return text;
  if (pageLabel === null) return m.annot_view_card_image_alt_no_page();
  return isPageNumber(pageLabel)
    ? m.annot_view_card_image_alt({ page: pageLabel })
    : m.annot_view_card_image_alt_label({ label: pageLabel });
}

export function ExcerptText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const ref = useSanitizedHtml<HTMLParagraphElement>(text);
  return <p ref={ref} className={cn(EXCERPT_TEXT_CLASS, className)} />;
}

const EXCERPT_TEXT_CLASS = "zt:select-text";

export function appendExcerptText(
  parent: HTMLElement,
  text: string,
  className?: string,
): HTMLParagraphElement {
  const el = parent.createEl("p", { cls: cn(EXCERPT_TEXT_CLASS, className) });
  el.replaceChildren(sanitizeHTMLToDom(text));
  return el;
}

export function ExcerptPicture({
  demand,
  identity,
  alt,
  className,
}: {
  demand: ExcerptDisplayDemand;
  identity: string;
  alt: string;
  className?: string;
}) {
  const display = useSyncExternalStore(demand.subscribe, demand.snapshot);
  const owned = useRef<ExcerptImageOwnership | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [undecodable, setUndecodable] = useState<ExcerptImage | null>(null);
  useEffect(() => {
    const next = excerptImageOwnership({
      held: owned.current,
      display,
      identity,
      create: (image) =>
        URL.createObjectURL(
          new Blob([new Uint8Array(image.bytes)], {
            type: image.format.mimeType,
          }),
        ),
    });
    owned.current = next.owned;
    for (const stale of next.release) URL.revokeObjectURL(stale);
    setUrl(next.owned?.url ?? null);
  }, [display, identity]);
  useEffect(
    () => () => {
      const last = owned.current;
      owned.current = null;
      if (last) URL.revokeObjectURL(last.url);
    },
    [],
  );
  if (url === null && display.status === "reading")
    return <span aria-busy="true">{m.annot_view_image_loading()}</span>;
  if (url === null || undecodable === display.image)
    return <span>{m.annot_view_image_unavailable()}</span>;
  return (
    <img
      className={className}
      src={url}
      onError={() => {
        setUndecodable(display.image);
      }}
      alt={alt}
    />
  );
}
