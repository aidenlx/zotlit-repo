import type { PresentedCitation } from "#obsidian/citation-text/present.ts";

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

export type FormatWikilinkRun = (
  run: readonly RunMember<HTMLAnchorElement>[],
  index: number,
) => PresentedCitation | null;

export type SectionRuns = (readonly RunMember<HTMLAnchorElement>[])[];

export function hasInternalLink(root: HTMLElement): boolean {
  return root.querySelector(INTERNAL_LINK) !== null;
}

export function sectionCitationRuns(
  root: HTMLElement,
  citationOf: WikilinkCitationOf,
): SectionRuns {
  return citationRuns(
    [...root.querySelectorAll<HTMLAnchorElement>(INTERNAL_LINK)],
    (anchor) => citationRendered(anchor, citationOf),
    textBetween,
  );
}

export function renderCitationRuns(
  runs: SectionRuns,
  format: FormatWikilinkRun,
): number {
  let rendered = 0;
  for (const [index, run] of runs.entries()) {
    const content = format(run, index);
    if (content === null) continue;
    const first = run[0]!.source;
    for (const { source } of run.slice(1)) {
      removeBetween(first, source);
      source.remove();
    }
    showCitation(first, content, "suppress");
    first.classList.add(themeHook.citation, themeHook.literatureNoteLink);
    rendered += 1;
  }
  return rendered;
}

export function sectionLinktexts(root: HTMLElement): string[] {
  const linktexts: string[] = [];
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>(
    INTERNAL_LINK,
  )) {
    const linktext = citationLinktext(anchor);
    if (linktext !== null) linktexts.push(linktext);
  }
  return linktexts;
}

function citationRendered(
  anchor: HTMLAnchorElement,
  citationOf: WikilinkCitationOf,
): WikilinkCitation | null {
  const linktext = citationLinktext(anchor);
  return linktext === null ? null : citationOf(linktext);
}

function citationLinktext(anchor: HTMLAnchorElement): string | null {
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

function removeBetween(from: ChildNode, to: ChildNode): void {
  for (let node = from.nextSibling; node !== null && node !== to;) {
    const next = node.nextSibling;
    node.remove();
    node = next;
  }
}
