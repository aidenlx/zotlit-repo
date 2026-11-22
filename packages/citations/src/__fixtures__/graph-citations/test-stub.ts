import type { GraphColor, GraphData } from "obsidian";

import { themeProperty } from "@zotlit/plugin-kernel/theme-hooks.ts";

export function themeStates(
  literatureNote: string,
  citedWorkNode: string,
  citationLink?: string,
): void {
  document.body.style.setProperty(
    themeProperty.graphLiteratureNote,
    literatureNote,
  );
  document.body.style.setProperty(
    themeProperty.graphCitedWorkNode,
    citedWorkNode,
  );
  if (citationLink !== undefined) {
    document.body.style.setProperty(
      themeProperty.graphCitationLink,
      citationLink,
    );
  }
}

export function themeStatesNothing(): void {
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.body.removeAttribute("style");
}

export function graphNode(
  type: string,
  color?: GraphColor,
): GraphData["nodes"][string] {
  return { type, ...(color ? { color } : {}) };
}
