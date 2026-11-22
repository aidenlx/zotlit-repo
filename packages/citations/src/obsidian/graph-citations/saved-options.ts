import { Effect } from "effect";
import type { App, GraphOptions, WorkspaceLeaf } from "obsidian";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";

import { GRAPH_CORE_PLUGIN_ID, GRAPH_VIEW_TYPES } from "./install.ts";

export function savedGlobalOptions(app: App): GraphOptions | null {
  const graph = app.internalPlugins.getEnabledPluginById(GRAPH_CORE_PLUGIN_ID);
  return optionsOf((graph as { options?: unknown } | null)?.options);
}

export function deferredLeafOptions(leaf: WorkspaceLeaf): GraphOptions | null {
  const state = leaf.view.getState() as { options?: unknown } | null;
  return optionsOf(state?.options);
}

export function savedLeafOptions(layout: unknown): Map<string, GraphOptions> {
  const saved = new Map<string, GraphOptions>();
  if (layout === null) {
    Effect.runSyncWith(logServices)(
      Effect.logWarning(
        "Workspace file reader missing; local graph rows start fresh",
      ).pipe(withLogCategory("graph-citations")),
    );
    return saved;
  }
  collectLeafOptions(layout, saved);
  Effect.runSyncWith(logServices)(
    Effect.logDebug("Saved graph leaf options read").pipe(
      Effect.annotateLogs({ leaves: saved.size }),
      withLogCategory("graph-citations"),
    ),
  );
  return saved;
}

function collectLeafOptions(
  node: unknown,
  saved: Map<string, GraphOptions>,
): void {
  if (Array.isArray(node)) {
    for (const child of node) collectLeafOptions(child, saved);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const { id, type, state } = node as {
    id?: unknown;
    type?: unknown;
    state?: { type?: unknown; state?: { options?: unknown } };
  };
  const graphLeaf =
    type === "leaf" &&
    typeof id === "string" &&
    GRAPH_VIEW_TYPES.includes(state?.type as (typeof GRAPH_VIEW_TYPES)[number]);
  const options = graphLeaf ? optionsOf(state?.state?.options) : null;
  if (options) saved.set(id as string, options);
  for (const child of Object.values(node)) collectLeafOptions(child, saved);
}

function optionsOf(value: unknown): GraphOptions | null {
  return typeof value === "object" && value !== null
    ? (value as GraphOptions)
    : null;
}
