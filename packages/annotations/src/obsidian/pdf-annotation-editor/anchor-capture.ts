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

const OBSIDIAN_PDF_VIEW_TYPE = "pdf";

export function registerAnnotationAnchorCapture(viewType: string): Disposable {
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
          return native.call(
            this,
            routedViewState(viewState, eState, viewType),
            eState,
          );
        },
    }),
  );
}

function navigationSubpathOf(state: unknown): string | null {
  const subpath =
    typeof state === "object" && state !== null
      ? (state as { subpath?: unknown }).subpath
      : undefined;
  return typeof subpath === "string" ? subpath : null;
}

function routedViewState(
  viewState: ViewState,
  eState: unknown,
  viewType: string,
): ViewState {
  if (viewState.type !== OBSIDIAN_PDF_VIEW_TYPE) return viewState;
  const subpath = navigationSubpathOf(eState);
  if (subpath === null || anchorIn(subpath) === null) return viewState;
  return { ...viewState, type: viewType };
}

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
