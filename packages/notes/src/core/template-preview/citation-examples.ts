import {
  citekeysToCiteTemplateData,
  narrowBaseDataToCiteItemData,
} from "@zotlit/db";
import type {
  CitationTemplateData,
  CitationVariant,
  CiteRef,
  TemplateCiteItemData,
  TemplateFilenameItemData,
} from "@zotlit/db";
import type { ItemSnapshot } from "@zotlit/zotero-reads/contract/snapshot/types.ts";

import { restoreTemplateData } from "./restore-template-data.ts";
import { SAMPLE_ANNOTATIONS } from "./sample-annotations.ts";
import book from "./samples/book.json" with { type: "json" };
import journalArticle from "./samples/journal-article.json" with { type: "json" };

export const CITATION_EXAMPLE_IDS = [
  "one-item",
  "two-items",
  "item-with-page",
  "suppressed-author",
  "prefix-and-suffix",
  "annotation-citation",
] as const;

export type CitationExampleId = (typeof CITATION_EXAMPLE_IDS)[number];

export const DEFAULT_CITATION_EXAMPLE: CitationExampleId = "one-item";

export interface CitationPreviewSelection {
  readonly variant: CitationVariant;
  readonly example: CitationExampleId | null;
}

export function isCitationExampleId(value: string): value is CitationExampleId {
  return (CITATION_EXAMPLE_IDS as readonly string[]).includes(value);
}

export function citationExampleData(
  id: CitationExampleId,
  variant: CitationVariant,
): CitationTemplateData {
  return citekeysToCiteTemplateData(exampleRefs()[id], variant);
}

export function sampleItemCitation(
  snapshot: ItemSnapshot,
  variant: CitationVariant,
): CitationTemplateData {
  return citekeysToCiteTemplateData([citedRef(snapshot)], variant);
}

const HIGHLIGHT_PAGE_LABEL = highlightPageLabel();

function highlightPageLabel(): string {
  const pageLabel = SAMPLE_ANNOTATIONS.find(
    ({ id }) => id === "example:highlight",
  )?.root.pageLabel;
  if (typeof pageLabel !== "string") {
    throw new Error(
      "The bundled Sample Annotations carry no 'example:highlight' with a page label.",
    );
  }
  return pageLabel;
}

const article = journalArticle as unknown as ItemSnapshot;
const monograph = book as unknown as ItemSnapshot;

export const CITATION_EXAMPLE_ITEM: ItemSnapshot = article;

function exampleRefs(): Record<CitationExampleId, readonly CiteRef[]> {
  const cited = citedRef(article);
  return {
    "one-item": [cited],
    "two-items": [cited, citedRef(monograph)],
    "item-with-page": [{ ...cited, locator: "12-14", label: "page" }],
    "suppressed-author": [{ ...cited, suppressAuthor: true }],
    "prefix-and-suffix": [
      { ...cited, prefix: "see ", suffix: " for a review" },
    ],
    "annotation-citation": [
      { ...cited, locator: HIGHLIGHT_PAGE_LABEL, label: "page" },
    ],
  };
}

function citedRef(snapshot: ItemSnapshot): CiteRef {
  const item = citedItem(snapshot);
  return { citationKey: item.citationKey, item };
}

function citedItem(snapshot: ItemSnapshot): TemplateCiteItemData {
  const base = restoreTemplateData(
    snapshot.roots.filename,
    snapshot.descriptors.filename,
  ) as unknown as TemplateFilenameItemData;
  const {
    authors: _authors,
    authorsShort: _authorsShort,
    collections: _collections,
    ...item
  } = narrowBaseDataToCiteItemData(base, base.citationKey);
  return item;
}
