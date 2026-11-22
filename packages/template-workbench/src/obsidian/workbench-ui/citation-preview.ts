import type { CitationVariant } from "@zotlit/db";
import type { CitationExampleId } from "@zotlit/notes/core/template-preview/citation-examples.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

const EXAMPLE_LABEL: Record<CitationExampleId, () => string> = {
  "one-item": m.workbench_citation_example_one_item,
  "two-items": m.workbench_citation_example_two_items,
  "item-with-page": m.workbench_citation_example_item_with_page,
  "suppressed-author": m.workbench_citation_example_suppressed_author,
  "prefix-and-suffix": m.workbench_citation_example_prefix_and_suffix,
  "annotation-citation": m.workbench_citation_example_annotation_citation,
};

const VARIANT_LABEL: Record<CitationVariant, () => string> = {
  main: m.workbench_citation_variant_main,
  alt: m.workbench_citation_variant_alt,
};

export function citationExampleLabel(id: CitationExampleId): string {
  return EXAMPLE_LABEL[id]();
}

export function citationVariantLabel(variant: CitationVariant): string {
  return VARIANT_LABEL[variant]();
}
