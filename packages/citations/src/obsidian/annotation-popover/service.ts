import type { NavigationPane } from "#obsidian/citekey-navigation/index.ts";
// The Annotation Popover as an Effect service tag; the layer that draws it is
// in ./layer.tsx.
import { Context } from "effect";
import type { Effect } from "effect";
import type { HoverParent } from "obsidian";

import type { AnnotationOpenUriOptions } from "@zotlit/zotero-types/uri";

/** One hovered Durable Annotation Link. */
export interface AnnotationHoverRequest {
  event: MouseEvent;
  /** What Obsidian hangs the popover off, and hides it with. */
  hoverParent: HoverParent;
  targetEl: HTMLElement;
  /** The note the link is written in, which a comment's own links resolve against. */
  sourcePath: string;
  /** The Annotation the link names, by bare keys. */
  link: AnnotationOpenUriOptions;
  /** Opens the Literature Note of the Annotation's parent Item. */
  open: (indexedKey: string, pane: NavigationPane) => void;
}

export class AnnotationPopover extends Context.Service<
  AnnotationPopover,
  {
    /**
     * Opens the Citation Popover of the Item a hovered link's Annotation
     * belongs to, with the Annotation drawn above the Item's reference.
     *
     * @returns settles once the reference's first read has drawn, or has been
     *   dropped because a newer read or a hide superseded it. A hover needs
     *   not wait on it.
     */
    show(request: AnnotationHoverRequest): Effect.Effect<void>;
  }
>()("zotlit/annotation-popover/AnnotationPopover") {}
