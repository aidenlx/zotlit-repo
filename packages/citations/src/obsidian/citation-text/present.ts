import type { CitedWork } from "#obsidian/citekey-navigation/index.ts";
import type { ProfilePresentationFailure } from "#obsidian/pandoc/document-presentation.ts";
import type { RenderedCitation } from "#obsidian/pandoc/engine.ts";

import type { SectionRange } from "@zotlit/obsidian-kit/reading-view.ts";
import type { CitationSource } from "@zotlit/plugin-kernel/citation-source.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import { heldResolution } from "@zotlit/zotero-reads/contract/citation-lookup.ts";
import type { CitationLookupAnswer } from "@zotlit/zotero-reads/contract/citation-lookup.ts";
import type { CitekeyResolution } from "@zotlit/zotero-reads/contract/citation-lookup.ts";

import { renderInlineContent } from "#obsidian/pandoc/inline-content.tsx";

export type {
  CitationKey,
  CitationSource,
} from "@zotlit/plugin-kernel/citation-source.ts";

export interface HeldCitation extends CitationSource {
  works?: readonly string[];
}

export function citationKey({
  source,
  works,
}: Pick<HeldCitation, "source" | "works">): string {
  return works === undefined ? source : [source, ...works].join("\n");
}

export interface PresentedCitation {
  text: RenderedCitation;
  serials: readonly (number | undefined)[];
}

export function presentedCitationEqual(
  left: PresentedCitation,
  right: PresentedCitation,
): boolean {
  return (
    left === right ||
    (JSON.stringify(left.text) === JSON.stringify(right.text) &&
      left.serials.length === right.serials.length &&
      left.serials.every((serial, index) => serial === right.serials[index]))
  );
}

export interface FormattedOccurrence extends PresentedCitation {
  start: number;
}

export type CitationCoordinate =
  | { kind: "offset"; start: number }
  | ({ kind: "section"; ordinal: number } & SectionRange);

export interface ShownCitation {
  citation: HeldCitation;
  at?: CitationCoordinate;
}

export interface DocumentCitations {
  lookup: CitationLookupAnswer;
  presentationFailure?: ProfilePresentationFailure;
  formatted: ReadonlyMap<string, readonly FormattedOccurrence[]>;
  entrySerials: boolean;
  summaries: ReadonlyMap<string, string>;
  literalWorks: ReadonlyMap<string, string>;
}

export type SummaryOf = (citekey: string) => string | undefined;

export function literalSummaryOf({
  summaries,
  literalWorks,
}: DocumentCitations): SummaryOf {
  return (citekey) => {
    const indexedKey = literalWorks.get(citekey);
    return indexedKey === undefined ? undefined : summaries.get(indexedKey);
  };
}

export type CitationKeyState = "pending" | "resolved" | "missing" | "ambiguous";

export type KeyStateOf = (citekey: string) => CitationKeyState;

export type CitationState =
  | "resolved"
  | "pending"
  | "unresolved"
  | "partially-unresolved"
  | "ambiguous";

export function citekeyState(
  resolution: CitekeyResolution | null,
): CitationKeyState {
  if (resolution === null) return "pending";
  switch (resolution.kind) {
    case "unique":
      return "resolved";
    case "ambiguous":
      return "ambiguous";
    case "missing":
      return "missing";
  }
}

export function literalKeyStateOf(citations: DocumentCitations): KeyStateOf {
  const summaryOf = literalSummaryOf(citations);
  return (citekey) => {
    if (summaryOf(citekey) !== undefined) return "resolved";
    const state = citekeyState(heldResolution(citations.lookup, citekey));
    return state === "pending" || state === "ambiguous" ? state : "missing";
  };
}

export function citationKeyStates(
  { keys }: CitationSource,
  stateOf: KeyStateOf,
): CitationKeyState[] {
  return keys.map((key) => stateOf(key.citekey));
}

export function citationState(
  states: readonly CitationKeyState[],
): CitationState {
  if (states.some((state) => state === "pending")) return "pending";
  if (states.some((state) => state === "missing")) {
    return states.some((state) => state === "resolved")
      ? "partially-unresolved"
      : "unresolved";
  }
  return states.some((state) => state === "ambiguous")
    ? "ambiguous"
    : "resolved";
}

export function citationStateHooks(state: CitationState): string[] {
  switch (state) {
    case "resolved":
      return [];
    case "pending":
      return [themeHook.citationKeyPending];
    case "unresolved":
      return [themeHook.citationKeyUnresolved];
    case "partially-unresolved":
      return [themeHook.citationKeyPartiallyUnresolved];
    case "ambiguous":
      return [themeHook.citationKeyAmbiguous];
  }
}

export function citedWorks(
  { source, keys }: CitationSource,
  citations: DocumentCitations,
): CitedWork[] {
  const summaryOf = literalSummaryOf(citations);
  const works = new Map<string, CitedWork>();
  for (const key of keys) {
    const { citekey } = key;
    if (works.has(citekey)) continue;
    works.set(citekey, {
      citekey,
      indexedKey: citations.literalWorks.get(citekey),
      label: summaryOf(citekey) ?? source.slice(key.start, key.end),
    });
  }
  return [...works.values()];
}

export function citationContent(
  citation: HeldCitation,
  { formatted }: DocumentCitations,
  at?: CitationCoordinate,
): PresentedCitation | null {
  const occurrences = formatted.get(citationKey(citation));
  if (occurrences === undefined) return null;
  return occurrenceAt(occurrences, at) ?? occurrences[0]!;
}

export function shownCitationContent(
  { citation, at }: ShownCitation,
  { formatted }: DocumentCitations,
): PresentedCitation | null {
  const occurrences = formatted.get(citationKey(citation));
  if (occurrences === undefined) return null;
  return at === undefined
    ? occurrences[0]!
    : (occurrenceAt(occurrences, at) ?? null);
}

function occurrenceAt(
  occurrences: readonly FormattedOccurrence[],
  at: CitationCoordinate | undefined,
): FormattedOccurrence | undefined {
  if (at === undefined) return undefined;
  if (at.kind === "offset") {
    return occurrences.find(({ start }) => start === at.start);
  }
  return occurrences.filter(({ start }) => start >= at.from && start < at.to)[
    at.ordinal
  ];
}

export function sectionCoordinates(
  citations: readonly HeldCitation[],
  section: SectionRange | null,
): (CitationCoordinate | undefined)[] {
  if (section === null) return citations.map(() => undefined);
  const counts = new Map<string, number>();
  return citations.map((citation) => {
    const identity = citationKey(citation);
    const ordinal = counts.get(identity) ?? 0;
    counts.set(identity, ordinal + 1);
    return { kind: "section", ...section, ordinal };
  });
}

export function showCitation(
  element: Element,
  content: PresentedCitation | string,
  links: "render" | "suppress" = "render",
): void {
  if (typeof content === "string") {
    element.replaceChildren(content);
    return;
  }
  renderInlineContent(element, {
    nodes: content.text.content,
    serials: content.serials,
    links,
  });
}

export function citationElement(
  doc: Document,
  content: PresentedCitation | string,
  themeClasses: readonly string[] = [],
): HTMLElement {
  const element = doc.win.createSpan();
  element.classList.add(themeHook.citation, ...themeClasses);
  showCitation(element, content);
  return element;
}
