import type { Effect } from "effect";

import { viewRuntime } from "@zotlit/obsidian-kit/view-atoms.ts";
import type { ViewRegistryHandle } from "@zotlit/obsidian-kit/view-atoms.ts";

import type { TargetOpenGesture } from "./actions.ts";
import { openGesture } from "./actions.ts";
import type { OpenOutcome, TargetOpener } from "./open-target.ts";

export const openTargetCommand = viewRuntime.fn(
  (open: Effect.Effect<OpenOutcome>) => open,
  { concurrent: true },
);

export function viewTargetOpener(
  registry: ViewRegistryHandle,
  opener: Pick<TargetOpener["Service"], "open">,
): TargetOpenGesture {
  return openGesture(opener, (open) => registry.set(openTargetCommand, open));
}
