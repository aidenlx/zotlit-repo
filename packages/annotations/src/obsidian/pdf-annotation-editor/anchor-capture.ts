// The open of an Obsidian PDF view whose subpath carries an Annotation Anchor,
// sent to the ZotLit reader at the one place every open crosses: the leaf's
// `setViewState`. The reader view hands the subpath to its reader, and the
// binding takes the Anchor from there.
//
// @see apps/obsidian/docs/adr/0046-landing-on-a-mark-is-an-ephemeral-state-contract-read-at-the-leaf.md

import { around } from "monkey-around";
import { WorkspaceLeaf } from "obsidian";
import type { ViewState } from "obsidian";

import {
  ANNOTATION_ANCHOR_KEY,
  ATTACHMENT_ANCHOR_KEY,
  parseAnnotationSubpath,
} from "@zotlit/db";
import type { ParsedAnnotationSubpath } from "@zotlit/db";
import { disposable } from "@zotlit/obsidian-kit/disposables.ts";

import { ZOTLIT_PDF_VIEW_TYPE } from "./view-type.ts";

const OBSIDIAN_PDF_VIEW_TYPE = "pdf";

/**
 * Patch `WorkspaceLeaf.prototype.setViewState` to send an Obsidian PDF view
 * open whose subpath carries an Anchor to the ZotLit reader instead. A plain
 * `#page=N` open keeps Obsidian's view.
 */
export function registerAnnotationAnchorCapture(): Disposable {
  const host = WorkspaceLeaf.prototype as unknown as {
    setViewState: (viewState: ViewState, eState?: unknown) => Promise<void>;
  };
  return disposable(
    around(host, {
      setViewState: (native) =>
        function (
          this: WorkspaceLeaf,
          viewState: ViewState,
          eState?: unknown,
        ): Promise<void> {
          return native.call(this, routedViewState(viewState, eState), eState);
        },
    }),
  );
}

/**
 * The subpath one ephemeral state navigates to, and `null` for a state that is
 * no navigation at all.
 *
 * Obsidian sets an ephemeral state for a focus, a scroll and a rename as well
 * as for an open — `focusLeaf` sends `{ focus: true }` every time a leaf takes
 * focus. Only a state carrying a subpath says where the leaf is aimed.
 */
function navigationSubpathOf(state: unknown): string | null {
  const subpath =
    typeof state === "object" && state !== null
      ? (state as { subpath?: unknown }).subpath
      : undefined;
  return typeof subpath === "string" ? subpath : null;
}

function routedViewState(viewState: ViewState, eState: unknown): ViewState {
  if (viewState.type !== OBSIDIAN_PDF_VIEW_TYPE) return viewState;
  const subpath = navigationSubpathOf(eState);
  if (subpath === null || anchorIn(subpath) === null) return viewState;
  return { ...viewState, type: ZOTLIT_PDF_VIEW_TYPE };
}

/**
 * The Anchor one subpath carries, for a view showing a PDF: an Annotation to
 * land on, the Attachment the open named, or both.
 */
export function anchorIn(subpath: string): ParsedAnnotationSubpath | null {
  if (
    !(
      subpath.includes(ANNOTATION_ANCHOR_KEY) ||
      subpath.includes(ATTACHMENT_ANCHOR_KEY)
    )
  ) {
    return null;
  }
  const anchor = parseAnnotationSubpath(subpath);
  return anchor.annotation === null && anchor.attachment === null
    ? null
    : anchor;
}
