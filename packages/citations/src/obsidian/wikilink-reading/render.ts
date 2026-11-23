import type { PresentedCitation } from "#obsidian/citation-text/present.ts";
import { createRoot } from "react-dom/client";

import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import { citationRuns } from "@zotlit/plugin-kernel/wikilink-citation.ts";
import type {
  RunMember,
  WikilinkCitation,
} from "@zotlit/plugin-kernel/wikilink-citation.ts";

import { showCitation } from "#obsidian/citation-text/present.ts";

const INTERNAL_LINK = "a.internal-link";

const ALIAS_MARKER = "aria-label";

function breadcrumb(linktext: string): string {
  return linktext
    .split("#")
    .filter((segment) => segment !== "")
    .join(" > ")
    .trim();
}

export type WikilinkCitationOf = (linktext: string) => WikilinkCitation | null;

type CitationRun = readonly RunMember<HTMLAnchorElement>[];

export type FormatWikilinkRun = (
  run: CitationRun,
  index: number,
) => PresentedCitation | null;

export type SectionRuns = CitationRun[];

export type RenderedRuns = Map<CitationRun, () => void>;

export function hasInternalLink(root: HTMLElement): boolean {
  return root.querySelector(INTERNAL_LINK) !== null;
}

export function sectionCitationRuns(
  root: HTMLElement,
  citationOf: WikilinkCitationOf,
  renderedAnchors?: ReadonlySet<HTMLAnchorElement>,
): SectionRuns {
  return citationRuns(
    [...root.querySelectorAll<HTMLAnchorElement>(INTERNAL_LINK)],
    (anchor) => {
      const linktext = citationLinktext(anchor, renderedAnchors);
      return linktext === null ? null : citationOf(linktext);
    },
    textBetween,
  );
}

export function renderCitationRuns(
  runs: SectionRuns,
  format: FormatWikilinkRun,
  renderedRuns?: RenderedRuns,
): number {
  let rendered = 0;
  for (const [index, run] of runs.entries()) {
    const content = format(run, index);
    if (content === null) continue;
    const first = run[0]!.source;
    const original = renderedRuns && {
      children: [...first.childNodes],
      siblings: [] as ChildNode[],
    };
    for (const { source } of run.slice(1)) {
      removeBetween(first, source, original?.siblings);
      original?.siblings.push(source);
      source.remove();
    }
    if (original) {
      first.replaceChildren();
      renderedRuns?.set(run, () => {
        createRoot(first).unmount();
        first.replaceChildren(...original.children);
        first.after(...original.siblings);
        first.classList.remove(
          themeHook.citation,
          themeHook.literatureNoteLink,
        );
        delete first.dataset["ztClick"];
      });
    }
    showCitation(first, content, "suppress");
    first.classList.add(themeHook.citation, themeHook.literatureNoteLink);
    rendered += 1;
  }
  return rendered;
}

export function sectionLinktexts(
  root: HTMLElement,
  renderedAnchors: ReadonlySet<HTMLAnchorElement>,
): string[] {
  const linktexts: string[] = [];
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>(
    INTERNAL_LINK,
  )) {
    const linktext = citationLinktext(anchor, renderedAnchors);
    if (linktext !== null) linktexts.push(linktext);
  }
  return linktexts;
}

function citationLinktext(
  anchor: HTMLAnchorElement,
  renderedAnchors: ReadonlySet<HTMLAnchorElement> | undefined,
): string | null {
  if (renderedAnchors?.has(anchor)) return null;
  const linktext = anchor.dataset["href"];
  if (linktext === undefined) return null;
  if (anchor.hasAttribute(ALIAS_MARKER)) return null;
  if (anchor.textContent !== breadcrumb(linktext)) return null;
  return linktext;
}

function textBetween(
  previous: HTMLAnchorElement,
  anchor: HTMLAnchorElement,
): string | null {
  if (previous.parentNode !== anchor.parentNode) return null;
  let text = "";
  for (
    let node = previous.nextSibling;
    node !== anchor;
    node = node?.nextSibling ?? null
  ) {
    if (node === null || node.nodeType !== Node.TEXT_NODE) return null;
    text += node.nodeValue ?? "";
  }
  return text;
}

function removeBetween(
  from: ChildNode,
  to: ChildNode,
  removed?: ChildNode[],
): void {
  for (let node = from.nextSibling; node !== null && node !== to;) {
    const next = node.nextSibling;
    removed?.push(node);
    node.remove();
    node = next;
  }
}
