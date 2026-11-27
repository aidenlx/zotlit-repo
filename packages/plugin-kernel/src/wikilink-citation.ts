import {
  formatPandocCitation,
  PandocCitationError,
  scanPandocCitations,
} from "@zotlit/templates/pandoc-citation";
import type {
  PandocCitationForm,
  PandocCitationItem,
} from "@zotlit/templates/pandoc-citation";

import type { CitationRunItem } from "./citation-fragment.ts";
import { citationRunItem } from "./citation-fragment.ts";
import type { CitationSource } from "./citation-source.ts";

const FRAGMENT_PREFIX = "cite:";

interface CitationLinkTarget {
  linkpath: string;
  fragment: string | null;
}

export function citationTarget(linktext: string): CitationLinkTarget | null {
  const hash = linktext.indexOf("#");
  if (hash === -1) {
    return linktext === "" ? null : { linkpath: linktext, fragment: null };
  }
  const linkpath = linktext.slice(0, hash);
  if (linkpath === "") return null;
  const subpath = linktext.slice(hash + 1);
  if (!subpath.startsWith(FRAGMENT_PREFIX)) return null;
  return { linkpath, fragment: subpath.slice(FRAGMENT_PREFIX.length) };
}

export interface LiteratureNoteTarget {
  path: string;
  indexedKey: string;
  citationKey: string | null;
}

export interface WikilinkCitationContext {
  literatureNote: (linkpath: string) => LiteratureNoteTarget | null;
  enabled: boolean;
}

export interface WikilinkCitation {
  item: CitationRunItem;
  indexedKey: string;
}

export function wikilinkCitation(
  linktext: string,
  context: WikilinkCitationContext,
): WikilinkCitation | null {
  const target = citationTarget(linktext);
  if (target === null) return null;
  if (!context.enabled) return null;
  const note = context.literatureNote(target.linkpath);
  if (note === null) return null;
  const item = citationRunItem({
    citationKey: note.citationKey,
    notePath: note.path,
    fragment: target.fragment,
  });
  if (item === null) return null;
  try {
    formatPandocCitation([pandocItem(item)], pandocForm(item));
  } catch (error) {
    if (error instanceof PandocCitationError) return null;
    throw error;
  }
  return {
    item,
    indexedKey: note.indexedKey,
  };
}

export interface RunMember<T> {
  source: T;
  citation: WikilinkCitation;
}

export interface RunCitationSource extends CitationSource {
  works: string[];
}

export function citationOfRun<T>(
  run: readonly RunMember<T>[],
): RunCitationSource {
  const items = run.map(({ citation }) => citation.item);
  const source = formatPandocCitation(
    items.map(pandocItem),
    pandocForm(items[0]!),
  );
  const [citation] = scanPandocCitations(source);
  return {
    source,
    keys: citation!.items.map(({ citationKey, start, end }) => ({
      citekey: citationKey,
      start,
      end,
    })),
    works: run.map(({ citation }) => citation.indexedKey),
  };
}

function pandocForm(item: CitationRunItem): PandocCitationForm {
  return item.details.mode === "author-in-text"
    ? "prefer-author-in-text"
    : "normal";
}

function pandocItem({
  citekey,
  details,
  labelShort,
}: CitationRunItem): PandocCitationItem {
  return {
    citationKey: citekey,
    prefix: details.prefix === null ? null : `${details.prefix} `,
    suffix: details.suffix === null ? null : `, ${details.suffix}`,
    locator:
      details.locator === null
        ? null
        : { label: labelShort!, value: details.locator },
    suppressAuthor: details.mode === "suppress-author",
  };
}

export function citationRuns<T>(
  links: readonly T[],
  citationOf: (link: T) => WikilinkCitation | null,
  textBetween: (previous: T, next: T) => string | null,
): RunMember<T>[][] {
  const runs: RunMember<T>[][] = [];
  let previous: T | null = null;
  for (const link of links) {
    const citation = citationOf(link);
    if (citation === null) {
      previous = null;
      continue;
    }
    const separator = previous === null ? null : textBetween(previous, link);
    previous = link;
    const open = runs.at(-1);
    if (open !== undefined && separator !== null && JOINS_RUN.test(separator)) {
      open.push({ source: link, citation });
      continue;
    }
    runs.push([{ source: link, citation }]);
  }
  return runs;
}

const JOINS_RUN = /^[ \t]*;[ \t]*$/u;
