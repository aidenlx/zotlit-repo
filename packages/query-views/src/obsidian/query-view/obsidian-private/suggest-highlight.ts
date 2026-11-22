import { Effect } from "effect";
import type { PopoverSuggest } from "obsidian";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";

let warned = false;

function chooser(suggest: PopoverSuggest<unknown>) {
  const { suggestions } = suggest;
  if (typeof suggestions?.forceSetSelectedItem === "function")
    return (at: number) => suggestions.forceSetSelectedItem?.(at, null);
  if (!warned) {
    warned = true;
    Effect.runSyncWith(logServices)(
      Effect.logWarning(
        "Obsidian's suggestion popover has no chooser to clear; suggestions open only once a key is typed",
      ).pipe(withLogCategory("obsidian-private", "suggest-highlight")),
    );
  }
  return null;
}

export function canClearSuggestHighlight(
  suggest: PopoverSuggest<unknown>,
): boolean {
  return chooser(suggest) !== null;
}

export function clearSuggestHighlight(suggest: PopoverSuggest<unknown>): void {
  chooser(suggest)?.(-1);
}
