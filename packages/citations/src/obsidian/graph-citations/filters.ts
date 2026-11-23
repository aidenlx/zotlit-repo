import type { GraphEngine, GraphOptions } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";

import type { GraphCitationFilters } from "./adapter.ts";
import { installToggleRow, rowFlag, toggleRowTarget } from "./rows.ts";

export const PANDOC_CITATIONS = "zotlit-pandoc-citations";
export const WIKILINK_CITATIONS = "zotlit-wikilink-citations";
export const CITATION_CONNECTED_ONLY = "zotlit-citation-connected-only";

export const FILTER_DEFAULTS = {
  [PANDOC_CITATIONS]: true,
  [WIKILINK_CITATIONS]: true,
  [CITATION_CONNECTED_ONLY]: false,
} as const;

export interface FilterRowsOptions {
  wikilinkCitations: boolean;
  saved: GraphOptions | null;
}

export function installFilterRows(
  engine: GraphEngine,
  options: FilterRowsOptions,
): Disposable {
  const rows = new DisposableStack();
  const target = toggleRowTarget(engine, {
    section: "filter",
    saved: options.saved,
  });
  if (!target) return rows;
  rows.use(
    installToggleRow(target, {
      key: PANDOC_CITATIONS,
      name: m.graph_option_pandoc_citations_name(),
      tooltip: m.graph_option_pandoc_citations_desc(),
      defaultValue: FILTER_DEFAULTS[PANDOC_CITATIONS],
    }),
  );
  if (options.wikilinkCitations) {
    rows.use(
      installToggleRow(target, {
        key: WIKILINK_CITATIONS,
        name: m.graph_option_wikilink_citations_name(),
        tooltip: m.graph_option_wikilink_citations_desc(),
        defaultValue: FILTER_DEFAULTS[WIKILINK_CITATIONS],
      }),
    );
  }
  rows.use(
    installToggleRow(target, {
      key: CITATION_CONNECTED_ONLY,
      name: m.graph_option_citation_connected_only_name(),
      tooltip: m.graph_option_citation_connected_only_desc(),
      defaultValue: FILTER_DEFAULTS[CITATION_CONNECTED_ONLY],
    }),
  );
  return rows;
}

export interface GraphCitationFiltersOptions {
  wikilinkCitations: boolean;
}

export function graphCitationFilters(
  engine: { options?: GraphOptions },
  options: GraphCitationFiltersOptions,
): GraphCitationFilters {
  return {
    pandocCitations: flag(engine, PANDOC_CITATIONS),
    wikilinkCitations: options.wikilinkCitations
      ? flag(engine, WIKILINK_CITATIONS)
      : null,
    citationConnectedOnly: flag(engine, CITATION_CONNECTED_ONLY),
  };
}

function flag(
  engine: { options?: GraphOptions },
  key: keyof typeof FILTER_DEFAULTS,
): boolean {
  return rowFlag(engine, key, FILTER_DEFAULTS[key]);
}
