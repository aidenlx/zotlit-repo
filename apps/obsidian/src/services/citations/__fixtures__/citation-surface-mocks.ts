import type { BibliographyItemRef } from "@zotlit/citations/desktop/pandoc/bibliography.ts";
import { Effect } from "effect";

import type { CslItemData } from "@zotlit/db";

import type { SeededWork } from "@zotlit/zotero-reads/__fixtures__/in-process.ts";

export const clipboardWrites: { html: string; text: string }[] = [];

export function collectClipboardWrite(content: {
  html: string;
  text: string;
}): Promise<"rich"> {
  clipboardWrites.push(content);
  return Promise.resolve("rich");
}

export const exportRun = {
  referencesStyleId: null as string | null,
  destination: "",
  override: undefined as string | null | undefined,
};

export function answerExportModal(
  _app: unknown,
  options: { referencesStyleId: string | null },
  resolve: (choices: { format: "html"; styleId: string | null; destination: string }) => void,
): { close(): void } {
  exportRun.referencesStyleId = options.referencesStyleId;
  resolve({
    format: "html",
    styleId: exportRun.override === undefined ? options.referencesStyleId : exportRun.override,
    destination: exportRun.destination,
  });
  return { close() {} };
}

export interface CitedWork {
  work: SeededWork;
  csl: CslItemData;
}

export const citedWorks = new Map<string, CitedWork>();

export function fetchCitedBibliography(_refs: readonly BibliographyItemRef[]): Effect.Effect<{
  source: "local-api";
  items: Map<string, CslItemData>;
}> {
  return Effect.succeed({
    source: "local-api",
    items: new Map(
      [...citedWorks].map(([indexedKey, work]) => [indexedKey, work.csl]),
    ),
  });
}

export function resetCitationSurfaceMocks(): void {
  clipboardWrites.length = 0;
  exportRun.referencesStyleId = null;
  exportRun.destination = "";
  exportRun.override = undefined;
  citedWorks.clear();
}
