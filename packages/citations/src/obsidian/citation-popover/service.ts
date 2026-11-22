import type { CitationHoverRequest } from "#obsidian/citekey-navigation/index.ts";
import { Context } from "effect";
import type { Effect } from "effect";
import type { HoverParent } from "obsidian";

import type { PopoverPart } from "./visits.ts";

export interface WorkHoverRequest extends Pick<
  CitationHoverRequest,
  "event" | "hoverParent" | "targetEl"
> {
  work:
    | { kind: "item"; indexedKey: string }
    | { kind: "citekey"; citekey: string }
    | { kind: "annotation"; annotationKey: string };
  open: (
    indexedKey: string,
    pane: Parameters<CitationHoverRequest["open"]>[1],
  ) => void;
  lead?: (part: PopoverPart) => void;
}

export class CitationPopover extends Context.Service<
  CitationPopover,
  {
    show(request: CitationHoverRequest): Effect.Effect<void>;
    showWork(request: WorkHoverRequest): Effect.Effect<void>;
    hide(parent: HoverParent, targetEl?: HTMLElement): Effect.Effect<void>;
  }
>()("zotlit/citation-popover/CitationPopover") {}
