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

export interface WikilinkDisplayContext extends WikilinkCitationContext {
  selection: readonly DocRange[];
  textBetween: (from: number, to: number) => string;
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
    if (overlapsSelection(context.selection, first.group.from, last.group.to)) {
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
