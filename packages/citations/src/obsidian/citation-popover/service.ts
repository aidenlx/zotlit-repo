import type { CitationHoverRequest } from "#obsidian/citekey-navigation/index.ts";
// The Citation Popover as an Effect service tag; the layer that draws it is
// in ./layer.tsx.
import { Context } from "effect";
import type { Effect } from "effect";
import type { HoverParent } from "obsidian";

import type { PopoverPart } from "./visits.ts";

/** One work shown independently of a document or citation occurrence. */
export interface WorkHoverRequest extends Pick<
  CitationHoverRequest,
  "event" | "hoverParent" | "targetEl"
> {
  work:
    | { kind: "item"; indexedKey: string }
    | { kind: "citekey"; citekey: string }
    /** The parent Item of the Annotation `annotationKey`, an Indexed Key. */
    | { kind: "annotation"; annotationKey: string };
  /** Open the exact Item displayed, using its current Literature Note. */
  open: (
    indexedKey: string,
    pane: Parameters<CitationHoverRequest["open"]>[1],
  ) => void;
  /**
   * Starts drawing a part another surface owns above the entry, for as long as
   * the visit lasts: the Annotation of a Durable Annotation Link.
   */
  lead?: (part: PopoverPart) => void;
}

/**
 * Shows what a hovered citation cites: each work's formatted bibliography entry
 * stacked in citation order, with the actions that reach that work.
 *
 * The popover opens on the hover itself and fills once the entries are read, so
 * Obsidian's own timing decides when it appears rather than the read does. The
 * entries come from the same bibliography render the References Sidebar shows,
 * so both surfaces agree on the References Style and go stale together — an
 * open popover reads its own entries again on the drop, and the read it was
 * already waiting on is left where it lands. The hovered note's own properties
 * are the other input, so an edit to them redraws an open popover the same way.
 *
 * Every read stands on the note as it is now: the entries, the Entry Serials,
 * and a note-class style's own note text are all read again, so a Citation
 * Presentation change leaves nothing of the previous style on screen.
 */
export class CitationPopover extends Context.Service<
  CitationPopover,
  {
    show(request: CitationHoverRequest): Effect.Effect<void>;
    /** Completes once the hover's first read has drawn, or was dropped because the pointer moved on or the popover hid. */
    showWork(request: WorkHoverRequest): Effect.Effect<void>;
    /** Closes the owner's visit, including a card still waiting to open. */
    hide(parent: HoverParent, targetEl?: HTMLElement): Effect.Effect<void>;
  }
>()("zotlit/citation-popover/CitationPopover") {}
