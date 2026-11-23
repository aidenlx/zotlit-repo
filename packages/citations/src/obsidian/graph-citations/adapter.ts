import type { CitationOccurrence } from "#obsidian/citation-index/scan.ts";

import type { CitekeyResolution } from "@zotlit/zotero-reads/contract/citation-lookup.ts";

export type LinkMap = Record<string, Record<string, number>>;

export interface GraphCitationFilters {
  pandocCitations: boolean;
  wikilinkCitations: boolean | null;
  citationConnectedOnly: boolean;
}

export interface GraphCitationInput {
  occurrences: ReadonlyMap<string, readonly CitationOccurrence[]>;
  resolveCitekey: (citekey: string) => CitekeyResolution | null;
  resolveLink: (linkpath: string, sourcePath: string) => string | null;
  notePathsOf: (indexedKey: string) => readonly string[];
  literatureNotes: Iterable<string>;
  resolvedLinks: LinkMap;
  filters: GraphCitationFilters;
}

export interface GraphCitationAdditions {
  resolvedLinks: LinkMap;
  unresolvedLinks: LinkMap;
  citationLinks: LinkMap;
  citedWorkNodes: ReadonlyMap<string, string>;
  literatureNotes: ReadonlySet<string>;
  hiddenLinks: LinkMap;
  survivingPaths: ReadonlySet<string> | null;
}

export const NO_ADDITIONS: GraphCitationAdditions = {
  resolvedLinks: {},
  unresolvedLinks: {},
  citationLinks: {},
  citedWorkNodes: new Map(),
  literatureNotes: new Set(),
  hiddenLinks: {},
  survivingPaths: null,
};

const CITED_WORK_NODE_PREFIX = "zotlit#cited-work/";

export function citedWorkNodeId(citekey: string): string {
  return `${CITED_WORK_NODE_PREFIX}@${citekey.replaceAll("/", "∕")}`;
}

export function graphCitationAdditions(
  input: GraphCitationInput,
): GraphCitationAdditions {
  const { filters } = input;
  const resolvedLinks: LinkMap = {};
  const unresolvedLinks: LinkMap = {};
  const citationLinks: LinkMap = {};
  const citedWorkNodes = new Map<string, string>();
  const literatureNotes = new Set(input.literatureNotes);
  const citingPaths = new Set<string>();
  const wikilinks = wikilinkCitationEdges(input, literatureNotes);
  const hiddenLinks = filters.wikilinkCitations === false ? wikilinks : {};
  if (filters.wikilinkCitations === true) {
    for (const [path, targets] of Object.entries(wikilinks)) {
      citingPaths.add(path);
      for (const target of Object.keys(targets)) {
        (citationLinks[path] ??= {})[target] = 1;
      }
    }
  }

  for (const [path, occurrences] of input.occurrences) {
    const linked = input.resolvedLinks[path] ?? {};
    for (const { kind, raw } of occurrences) {
      if (kind !== "citekey") continue;
      const notes = literatureNotesOf(input, raw);
      if (!filters.pandocCitations) continue;
      citingPaths.add(path);
      if (notes.length === 0) {
        const id = citedWorkNodeId(raw);
        citedWorkNodes.set(id, raw);
        (unresolvedLinks[path] ??= {})[id] = 1;
        (citationLinks[path] ??= {})[id] = 1;
        continue;
      }
      const note = notes.find((candidate) => linked[candidate]) ?? notes[0]!;
      (citationLinks[path] ??= {})[note] = 1;
      const drawn = (linked[note] ?? 0) - (hiddenLinks[path]?.[note] ?? 0);
      if (drawn > 0) continue;
      (resolvedLinks[path] ??= {})[note] = 1;
    }
  }

  return {
    resolvedLinks,
    unresolvedLinks,
    citationLinks,
    citedWorkNodes,
    literatureNotes,
    hiddenLinks,
    survivingPaths: filters.citationConnectedOnly
      ? new Set([...literatureNotes, ...citingPaths])
      : null,
  };
}

function wikilinkCitationEdges(
  input: GraphCitationInput,
  literatureNotes: ReadonlySet<string>,
): LinkMap {
  const edges: LinkMap = {};
  for (const [path, occurrences] of input.occurrences) {
    for (const { kind, raw } of occurrences) {
      if (kind !== "wikilink") continue;
      const target = input.resolveLink(raw, path);
      if (target === null || !literatureNotes.has(target)) continue;
      const targets = (edges[path] ??= {});
      targets[target] = (targets[target] ?? 0) + 1;
    }
  }
  return edges;
}

function literatureNotesOf(
  input: GraphCitationInput,
  citekey: string,
): readonly string[] {
  const resolution = input.resolveCitekey(citekey);
  if (resolution?.kind !== "unique") return [];
  return input.notePathsOf(resolution.item.indexedKey);
}
