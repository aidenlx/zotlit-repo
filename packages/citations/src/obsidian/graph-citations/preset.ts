import { Effect } from "effect";
import type { GraphColor, GraphOptions, WorkspaceLeaf } from "obsidian";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";

import {
  AUTHOR_TITLE_LABELS,
  CITATION_POPOVER,
  COLOR_CITATION_LINKS,
} from "./display.ts";
import {
  CITATION_CONNECTED_ONLY,
  PANDOC_CITATIONS,
  WIKILINK_CITATIONS,
} from "./filters.ts";
import { addLiteratureNotesGroup, groupsTarget } from "./groups.ts";
import { graphEngineOf, membersPresent } from "./install.ts";

export interface CitationGraphPresetOptions {
  wikilinkCitations: boolean;
  color: GraphColor;
}

function citationGraphPreset(
  options: Pick<CitationGraphPresetOptions, "wikilinkCitations">,
): GraphOptions {
  return {
    [PANDOC_CITATIONS]: true,
    ...(options.wikilinkCitations ? { [WIKILINK_CITATIONS]: true } : {}),
    [CITATION_CONNECTED_ONLY]: true,
    [COLOR_CITATION_LINKS]: true,
    [CITATION_POPOVER]: true,
    [AUTHOR_TITLE_LABELS]: true,
    showTags: false,
    showAttachments: false,
    hideUnresolved: false,
    showOrphans: false,
    showArrow: true,
  };
}

export function applyCitationGraphPreset(
  leaf: WorkspaceLeaf,
  options: CitationGraphPresetOptions,
): boolean {
  const viewType = leaf.view.getViewType();
  const engine = graphEngineOf(leaf, viewType);
  const present = membersPresent(
    "Graph leaf is missing its set-options path; Citation Graph preset not applied",
    {
      engine: Boolean(engine),
      "engine.setOptions": typeof engine?.setOptions === "function",
    },
    { viewType },
  );
  if (!present) return false;
  engine!.setOptions!(citationGraphPreset(options));
  const target = groupsTarget(engine!);
  const added = target ? addLiteratureNotesGroup(target, options.color) : false;
  Effect.runSyncWith(logServices)(
    Effect.logDebug("Citation Graph preset applied").pipe(
      Effect.annotateLogs({
        viewType,
        wikilinkCitations: options.wikilinkCitations,
        groupAdded: added,
      }),
      withLogCategory("graph-citations"),
    ),
  );
  return true;
}
