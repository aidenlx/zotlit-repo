// What one render is asked for: the draft and the paper it is shown against.

import type { ItemSnapshot } from "#snapshot/index.ts";

import type { CitationPreviewSelection } from "./citation-examples.ts";
import type { PartialPreviewSelection } from "./partial-preview.ts";
import type { AnnotationExample } from "./sample-annotations.ts";

export interface RenderOptions {
  /** Update uses a synthesized note when the host has no existing note. */
  readonly mode?: "create" | "update";
  readonly annotation?: AnnotationExample;
  /** Present only on a Citation Template render, which produces one Citation. */
  readonly citation?: CitationPreviewSelection;
  /** Present only on a Shared Partial render, which produces that partial's own text. */
  readonly partial?: PartialPreviewSelection;
}

export interface RenderRequest extends RenderOptions {
  readonly source: string;
  readonly snapshot: ItemSnapshot;
}
