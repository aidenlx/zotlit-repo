import type { CitationSource } from "#obsidian/citation-text/present.ts";

import { scanPandocCitations } from "@zotlit/templates/pandoc-citation";
import type { PandocTextSpan as TextSpan } from "@zotlit/templates/pandoc-citation";

const EXCLUDED_SELECTOR =
  "code, pre, a, .math, mjx-container, .frontmatter, .metadata-container";

export interface SectionCitation extends TextSpan, CitationSource {
  node: Text;
}

export function sectionCitations(root: HTMLElement): SectionCitation[] {
  const found: SectionCitation[] = [];
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (text.parentElement?.closest(EXCLUDED_SELECTOR)) continue;
    for (const { start, end, items } of scanPandocCitations(text.data)) {
      found.push({
        node: text,
        start,
        end,
        source: text.data.slice(start, end),
        keys: items.map((item) => ({
          citekey: item.citationKey,
          start: item.start - start,
          end: item.end - start,
        })),
      });
    }
  }
  return found;
}

export type FormatCitation = (
  citation: SectionCitation,
  index: number,
) => Node | null;

export function replaceCitations(
  citations: readonly SectionCitation[],
  format: FormatCitation,
): void {
  for (let index = citations.length - 1; index >= 0; index -= 1) {
    const citation = citations[index]!;
    const formatted = format(citation, index);
    if (!formatted) continue;
    const { node, start, end } = citation;
    node.splitText(end);
    node.splitText(start).replaceWith(formatted);
  }
}
