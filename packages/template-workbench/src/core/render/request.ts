import type { CitationPreviewSelection } from "@zotlit/notes/core/template-preview/citation-examples.ts";
import type { PartialPreviewSelection } from "@zotlit/notes/core/template-preview/partial-preview.ts";
import type { AnnotationExample } from "@zotlit/notes/core/template-preview/sample-annotations.ts";
import type { ItemSnapshot } from "@zotlit/zotero-reads/contract/snapshot/types.ts";

export interface RenderOptions {
  readonly mode?: "create" | "update";
  readonly annotation?: AnnotationExample;
  readonly citation?: CitationPreviewSelection;
  readonly partial?: PartialPreviewSelection;
}

export interface RenderRequest extends RenderOptions {
  readonly source: string;
  readonly snapshot: ItemSnapshot;
}
