import type { PartialChoice } from "#core/render/index.ts";
import { Effect } from "effect";
import type { App } from "obsidian";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";

import {
  DEFAULT_PARTIAL_CONTEXT,
  isPartialContext,
} from "#core/render/index.ts";

const STORAGE_KEY = "zotlit-partial-choice";

export type PartialChoiceStore = Pick<
  App,
  "loadLocalStorage" | "saveLocalStorage"
>;

export const DEFAULT_PARTIAL_CHOICE: PartialChoice = {
  context: DEFAULT_PARTIAL_CONTEXT,
  profile: null,
};

export function readPartialChoice(
  store: PartialChoiceStore,
  path: string | null,
): PartialChoice {
  if (path === null) return DEFAULT_PARTIAL_CHOICE;
  const held = heldChoices(store)[path];
  if (!held) return DEFAULT_PARTIAL_CHOICE;
  return {
    context: isPartialContext(held.context)
      ? held.context
      : DEFAULT_PARTIAL_CONTEXT,
    profile: typeof held.profile === "string" ? held.profile : null,
  };
}

export function writePartialChoice(
  store: PartialChoiceStore,
  path: string | null,
  choice: PartialChoice,
): void {
  if (path === null) return;
  const held = heldChoices(store);
  const isDefault =
    choice.context === DEFAULT_PARTIAL_CHOICE.context &&
    choice.profile === DEFAULT_PARTIAL_CHOICE.profile;
  if (isDefault) {
    if (!(path in held)) return;
    delete held[path];
  } else {
    held[path] = { context: choice.context, profile: choice.profile };
  }
  store.saveLocalStorage(STORAGE_KEY, held);
}

type HeldChoice = { context?: unknown; profile?: unknown };

function heldChoices(store: PartialChoiceStore): Record<string, HeldChoice> {
  const held: unknown = store.loadLocalStorage(STORAGE_KEY);
  if (held === null || typeof held !== "object" || Array.isArray(held)) {
    if (held !== null)
      Effect.runSyncWith(logServices)(
        Effect.logDebug("Discarded an unreadable partial choice store").pipe(
          withLogCategory("views", "template-workbench"),
        ),
      );
    return {};
  }
  return { ...(held as Record<string, HeldChoice>) };
}
