import type { HistoryDirection } from "#obsidian/annotation-repository/service.ts";
import type { Scope } from "obsidian";

import { registerKeymap } from "@zotlit/obsidian-kit/disposables.ts";

import { inTextEntry } from "#obsidian/pdf-annotation-editor/capability-affordance.ts";
import { historyVerbOf } from "#obsidian/pdf-annotation-editor/reader-keymap.ts";

export const CARD_SELECTOR = ".zt-annot-card";

export function onAnnotationCard(target: EventTarget | null): boolean {
  const node = target as Node | null;
  if (!node?.instanceOf(HTMLElement)) return false;
  return node.closest(CARD_SELECTOR) !== null;
}

export function mountCardHistoryKeys(
  scope: Scope,
  step: (direction: HistoryDirection) => void,
  platform: { isMacOS: boolean },
): Disposable {
  return registerKeymap(scope, null, null, (event) => {
    if (inTextEntry(event.target)) return;
    if (!onAnnotationCard(event.target)) return;
    const verb = historyVerbOf(event, platform.isMacOS);
    if (!verb) return;
    if (!event.repeat) step(verb);
    return false;
  });
}
