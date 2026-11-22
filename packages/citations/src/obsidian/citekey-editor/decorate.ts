import type {
  CitationKeyState,
  CitationSource,
  KeyStateOf,
} from "#obsidian/citation-text/present.ts";

import { scanPandocCitations } from "@zotlit/templates/pandoc-citation";
import type { PandocTextSpan as TextSpan } from "@zotlit/templates/pandoc-citation";

import { maskWikilinks } from "#obsidian/citation-index/scan.ts";

export interface CitekeyMark extends TextSpan {
  citekey: string;
}

const EXCLUDED_CLASSES: ReadonlySet<string> = new Set([
  "hmd-codeblock",
  "hmd-indented-code",
  "HyperMD-codeblock",
  "inline-code",
  "math",
  "math-block",
  "comment",
  "hmd-frontmatter",
  "url",
]);

export function isExcludedTokenClass(classes: string): boolean {
  return classes.split(" ").some((name) => EXCLUDED_CLASSES.has(name));
}

const FOOTNOTE_CLASS = "footref";

export function isFootnoteTokenClass(classes: string): boolean {
  return classes.split(" ").includes(FOOTNOTE_CLASS);
}

export const FOOTNOTE_WIDGET_CLASS = `cm-${FOOTNOTE_CLASS}`;

export function citekeyMarks(
  text: string,
  isExcluded: (span: TextSpan) => boolean,
): CitekeyMark[] {
  const marks: CitekeyMark[] = [];
  for (const citation of scanPandocCitations(maskWikilinks(text))) {
    for (const item of citation.items) {
      const span = {
        start: item.suppressAuthor ? item.start + 1 : item.start,
        end: item.end,
      };
      if (isExcluded(span)) continue;
      marks.push({ ...span, citekey: item.citationKey });
    }
  }
  return marks;
}

export interface StatedCitekeyMark extends CitekeyMark {
  state: CitationKeyState;
}

export function stateCitekeyMarks(
  marks: readonly CitekeyMark[],
  stateOf: KeyStateOf,
): StatedCitekeyMark[] {
  return marks.map((mark) => ({ ...mark, state: stateOf(mark.citekey) }));
}

export interface CitationRange extends TextSpan, CitationSource {}

export function citationRanges(
  text: string,
  isExcluded: (span: TextSpan) => boolean,
): CitationRange[] {
  const found: CitationRange[] = [];
  for (const { start, end, items } of scanPandocCitations(
    maskWikilinks(text),
  )) {
    if (isExcluded({ start, end })) continue;
    found.push({
      start,
      end,
      source: text.slice(start, end),
      keys: items.map((item) => ({
        citekey: item.citationKey,
        start: item.start - start,
        end: item.end - start,
      })),
    });
  }
  return found;
}

export function marksOutside(
  marks: readonly CitekeyMark[],
  replaced: readonly TextSpan[],
): CitekeyMark[] {
  return marks.filter(
    (mark) =>
      !replaced.some(
        ({ start, end }) => mark.start >= start && mark.end <= end,
      ),
  );
}
