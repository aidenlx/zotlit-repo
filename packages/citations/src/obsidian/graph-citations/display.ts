import type { GraphEngine, GraphOptions } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";

import { installToggleRow, rowFlag, toggleRowTarget } from "./rows.ts";

export const COLOR_CITATION_LINKS = "zotlit-color-citation-links";
export const AUTHOR_TITLE_LABELS = "zotlit-author-title-labels";
export const CITATION_POPOVER = "zotlit-citation-popover";

export const DISPLAY_DEFAULTS = {
  [COLOR_CITATION_LINKS]: false,
  [AUTHOR_TITLE_LABELS]: false,
  [CITATION_POPOVER]: false,
} as const;

export interface DisplayRowsOptions {
  saved: GraphOptions | null;
}

export function installDisplayRows(
  engine: GraphEngine,
  options: DisplayRowsOptions,
): Disposable {
  const rows = new DisposableStack();
  const target = toggleRowTarget(engine, {
    section: "display",
    saved: options.saved,
  });
  if (!target) return rows;
  const { childrenEl } = target.section;
  const nativeRowCount = childrenEl.children.length;
  rows.use(
    installToggleRow(target, {
      key: COLOR_CITATION_LINKS,
      name: m.graph_option_color_citation_links_name(),
      tooltip: m.graph_option_color_citation_links_desc(),
      defaultValue: DISPLAY_DEFAULTS[COLOR_CITATION_LINKS],
    }),
  );
  rows.use(
    installToggleRow(target, {
      key: CITATION_POPOVER,
      name: m.graph_option_citation_popover_name(),
      tooltip: m.graph_option_citation_popover_desc(),
      defaultValue: DISPLAY_DEFAULTS[CITATION_POPOVER],
    }),
  );
  rows.use(
    installToggleRow(target, {
      key: AUTHOR_TITLE_LABELS,
      name: m.graph_option_author_title_labels_name(),
      tooltip: m.graph_option_author_title_labels_desc(),
      defaultValue: DISPLAY_DEFAULTS[AUTHOR_TITLE_LABELS],
    }),
  );
  childrenEl.prepend(...Array.from(childrenEl.children).slice(nativeRowCount));
  return rows;
}

export function colorCitationLinks(engine: {
  options?: GraphOptions;
}): boolean {
  return rowFlag(
    engine,
    COLOR_CITATION_LINKS,
    DISPLAY_DEFAULTS[COLOR_CITATION_LINKS],
  );
}
