import type { NavigationPane } from "#obsidian/citekey-navigation/index.ts";
import type { Effect } from "effect";
import { Context } from "effect";
import type { HoverParent } from "obsidian";

import type { AnnotationOpenUriOptions } from "@zotlit/zotero-types/uri";

export interface AnnotationHoverRequest {
  event: MouseEvent;
  hoverParent: HoverParent;
  targetEl: HTMLElement;
  sourcePath: string;
  link: AnnotationOpenUriOptions;
  open: (indexedKey: string, pane: NavigationPane) => void;
}

export class AnnotationPopover extends Context.Service<
  AnnotationPopover,
  {
    show(request: AnnotationHoverRequest): Effect.Effect<void>;
  }
>()("zotlit/annotation-popover/AnnotationPopover") {}
