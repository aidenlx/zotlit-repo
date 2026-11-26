import { around } from "monkey-around";
import type { ViewState } from "obsidian";

import {
  ANNOTATION_ANCHOR_KEY,
  ATTACHMENT_ANCHOR_KEY,
  parseAnnotationSubpath,
} from "@zotlit/db";
import type { ParsedAnnotationSubpath } from "@zotlit/db";
import { disposable } from "@zotlit/obsidian-kit/disposables.ts";
import type { AttachmentResolution } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";

export const OBSIDIAN_PDF_VIEW_TYPE = "pdf";

export type PdfViewer = "reader" | "obsidian";

export type ViewerRequest =
  | { readonly kind: "attachment" }
  | {
      readonly kind: "file";
      readonly anchored: boolean;
      readonly attachment: AttachmentResolution;
    };

export function viewerOf(
  connected: boolean,
  request: ViewerRequest,
): PdfViewer {
  if (!connected) return "obsidian";
  if (request.kind === "attachment" || request.anchored) return "reader";
  const { attachment } = request;
  return attachment.kind === "resolved" && attachment.openable
    ? "reader"
    : "obsidian";
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

export interface ViewStateHost {
  setViewState(viewState: ViewState, eState?: unknown): Promise<void>;
}

export interface ViewerRouting {
  readonly viewType: string;
  readonly attachmentOf: (
    path: string,
  ) => AttachmentResolution | Promise<AttachmentResolution>;
}

export function registerViewerRouting(
  host: ViewStateHost,
  routing: ViewerRouting,
): Disposable {
  return disposable(
    around(host, {
      setViewState: (native) =>
        function (
          this: ViewStateHost,
          viewState: ViewState,
          eState?: unknown,
        ): Promise<void> {
          const routed = routedViewState(viewState, eState, routing);
          return routed instanceof Promise
            ? routed.then((state) => native.call(this, state, eState))
            : native.call(this, routed, eState);
        },
    }),
  );
}

export function routedViewState(
  viewState: ViewState,
  eState: unknown,
  { viewType, attachmentOf }: ViewerRouting,
): ViewState | Promise<ViewState> {
  if (viewState.type !== OBSIDIAN_PDF_VIEW_TYPE) return viewState;
  const subpath = stringField(eState, "subpath");
  const anchored = subpath !== null && anchorIn(subpath) !== null;
  const path = stringField(viewState.state, "file");
  const choose = (attachment: AttachmentResolution): ViewState =>
    viewerOf(true, { kind: "file", anchored, attachment }) === "reader"
      ? { ...viewState, type: viewType }
      : viewState;
  if (anchored || path === null) return choose({ kind: "unresolved" });
  const attachment = attachmentOf(path);
  return attachment instanceof Promise
    ? attachment.then(choose)
    : choose(attachment);
}

function stringField(value: unknown, name: string): string | null {
  const field =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)[name]
      : undefined;
  return typeof field === "string" ? field : null;
}
