import type { MarkdownView } from "obsidian";

import type { CitationOccurrence } from "./service.ts";

export function flashOccurrence(
  view: MarkdownView,
  occurrence: CitationOccurrence,
): void {
  const { start, end } = occurrence.position;
  view.setEphemeralState({
    startLoc: start,
    endLoc: end,
    line: start.line,
  });
}
