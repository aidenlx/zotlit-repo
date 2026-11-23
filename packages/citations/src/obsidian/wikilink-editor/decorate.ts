import { RangeSet } from "@codemirror/state";
import type { DecorationSet, EditorView } from "@codemirror/view";

import { overlapsSelection } from "@zotlit/obsidian-kit/editor-decoration.ts";
import type { DocRange } from "@zotlit/obsidian-kit/editor-decoration.ts";
import {
  citationOfRun,
  citationRuns,
  wikilinkCitation,
} from "@zotlit/plugin-kernel/wikilink-citation.ts";
import type {
  RunCitationSource,
  WikilinkCitationContext,
} from "@zotlit/plugin-kernel/wikilink-citation.ts";

import type { WikilinkSpan } from "./scan.ts";

const SEARCH_MATCH_HIGHLIGHT = "obsidian-search-match-highlight";

export interface WikilinkDisplayContext extends WikilinkCitationContext {
  selection: readonly DocRange[];
  searchHighlights: readonly DocRange[];
  textBetween: (from: number, to: number) => string;
}

export function searchMatchHighlights(
  sources: readonly (DecorationSet | ((view: EditorView) => DecorationSet))[],
): DocRange[] {
  const sets = sources.filter((source) => typeof source !== "function");
  const matches: DocRange[] = [];
  for (const range = RangeSet.iter(sets); range.value !== null; range.next()) {
    if (
      !range.value.point &&
      range.value.spec.class === SEARCH_MATCH_HIGHLIGHT
    ) {
      matches.push({ from: range.from, to: range.to });
    }
  }
  return matches;
}

export interface WikilinkDecoration extends DocRange {
  citation: RunCitationSource;
  start: number;
  tokenClasses: readonly string[];
}

export function wikilinkDecorations(
  spans: readonly WikilinkSpan[],
  context: WikilinkDisplayContext,
): WikilinkDecoration[] {
  const runs = citationRuns(
    spans,
    (span) =>
      span.isEmbed || span.hasAlias
        ? null
        : wikilinkCitation(span.linktext, context),
    (previous, next) => context.textBetween(previous.outer.to, next.outer.from),
  );

  const decorations: WikilinkDecoration[] = [];
  for (const run of runs) {
    const first = run[0]!.source;
    const last = run.at(-1)!.source;
    const { from } = first.group;
    const { to } = last.group;
    if (
      overlapsSelection(context.selection, from, to) ||
      overlapsSelection(context.searchHighlights, from, to)
    ) {
      continue;
    }
    const citation = citationOfRun(run);
    decorations.push({
      from: first.inner.from,
      to: last.inner.to,
      citation,
      start: first.outer.from,
      tokenClasses: first.tokenClasses,
    });
  }
  return decorations;
}
