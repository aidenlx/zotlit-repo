import type { PandocTextSpan } from "@zotlit/templates/pandoc-citation";

export interface CitationKey extends PandocTextSpan {
  citekey: string;
}

export interface CitationSource {
  source: string;
  keys: CitationKey[];
}

export interface ScannedCitation extends PandocTextSpan {
  keys: CitationKey[];
}
