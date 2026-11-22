import type {
  QueryFileDataset,
  QueryFileView,
} from "#core/query-view/query-file.ts";

import * as m from "@zotlit/plugin-messages/messages.ts";

import { CARDS_LAYOUT } from "./cards-layout.tsx";
import { LIST_LAYOUT } from "./list-layout.tsx";
import { PAPERS_LAYOUT } from "./papers-layout.tsx";
import { TABLE_LAYOUT } from "./table-layout.tsx";

export interface QueryLayout {
  readonly type: string;
  readonly datasets: readonly QueryFileDataset[];
  readonly name: () => string;
  readonly icon: string;
}

export const QUERY_LAYOUTS: readonly QueryLayout[] = [
  {
    type: "annotations",
    datasets: ["annotations"],
    name: () => m.query_view_layout_annotations(),
    icon: "highlighter",
  },
  TABLE_LAYOUT,
  LIST_LAYOUT,
  CARDS_LAYOUT,
  PAPERS_LAYOUT,
];

export function layoutOf(view: QueryFileView): QueryLayout | undefined {
  const type = view.type || "annotations";
  return QUERY_LAYOUTS.find((layout) => layout.type === type);
}

export function layoutsFor(
  view: Pick<QueryFileView, "from">,
  offered?: readonly string[],
): QueryLayout[] {
  const dataset = view.from ?? "annotations";
  const fitting = QUERY_LAYOUTS.filter((layout) =>
    layout.datasets.includes(dataset),
  );
  if (!offered) return fitting;
  return offered.flatMap((type) =>
    fitting.filter((layout) => layout.type === type),
  );
}

export interface AnnotationsLayoutOptions {
  readonly cardWidth: number;
  readonly showComment: boolean;
  readonly showTags: boolean;
  readonly showPage: boolean;
}

export const CARD_WIDTH = { min: 200, max: 800, step: 10, default: 320 };

export const ANNOTATIONS_LAYOUT_DEFAULTS: AnnotationsLayoutOptions = {
  cardWidth: CARD_WIDTH.default,
  showComment: true,
  showTags: true,
  showPage: true,
};

export function annotationsLayoutOptions(
  view: QueryFileView | null,
): AnnotationsLayoutOptions {
  const source = view?.source ?? {};
  const flag = (key: keyof AnnotationsLayoutOptions) =>
    typeof source[key] === "boolean"
      ? source[key]
      : (ANNOTATIONS_LAYOUT_DEFAULTS[key] as boolean);
  const width = source.cardWidth;
  return {
    cardWidth:
      typeof width === "number" && Number.isFinite(width)
        ? Math.min(CARD_WIDTH.max, Math.max(CARD_WIDTH.min, width))
        : CARD_WIDTH.default,
    showComment: flag("showComment"),
    showTags: flag("showTags"),
    showPage: flag("showPage"),
  };
}
