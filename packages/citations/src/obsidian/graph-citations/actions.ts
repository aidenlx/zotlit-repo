import { Effect } from "effect";
import { Keymap } from "obsidian";
import type { App, Plugin, TFile } from "obsidian";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { GRAPH_CORE_PLUGIN_ID } from "./install.ts";
import type { GraphCitations } from "./service.ts";

export interface GraphCitationsActionDeps {
  app: App;
  graphCitations: Pick<GraphCitations["Service"], "enabled" | "applyPreset">;
  bridge: Pick<EffectBridge, "runSync">;
}

export function addGraphCitationsActions(
  plugin: Pick<Plugin, "addCommand">,
  deps: GraphCitationsActionDeps,
): void {
  plugin.addCommand({
    id: "open-citation-graph",
    name: m.command_open_citation_graph_name(),
    callback: () => openCitationGraph(deps),
  });
  plugin.addCommand({
    id: "open-local-citation-graph",
    name: m.command_open_local_citation_graph_name(),
    checkCallback: (checking) => {
      const file = deps.app.workspace.getActiveFile();
      if (!file) return false;
      if (checking) return true;
      void openLocalCitationGraph(deps, file);
      return true;
    },
  });
}

async function openCitationGraph(
  deps: GraphCitationsActionDeps,
): Promise<void> {
  if (!openable(deps)) return;
  const leaf = deps.app.workspace.getLeaf(
    Keymap.isModEvent(deps.app.lastEvent),
  );
  await leaf.setViewState({ type: "graph", active: true, state: {} });
  deps.bridge.runSync(deps.graphCitations.applyPreset(leaf));
}

export async function openLocalCitationGraph(
  deps: GraphCitationsActionDeps,
  file: TFile,
): Promise<void> {
  if (!openable(deps)) return;
  const { workspace } = deps.app;
  const group = workspace.getMostRecentLeaf() ?? undefined;
  const leaf = workspace.getLeaf("split", "vertical");
  await leaf.setViewState({
    type: "localgraph",
    active: true,
    group,
    state: { file: file.path },
  });
  deps.bridge.runSync(deps.graphCitations.applyPreset(leaf));
}

export type CitationGraphReadiness =
  | "ready"
  | "core-plugin-disabled"
  | "feature-off";

const BLOCKED = {
  "core-plugin-disabled": m.graph_citations_core_plugin_disabled,
  "feature-off": m.graph_citations_disabled,
} as const satisfies Record<
  Exclude<CitationGraphReadiness, "ready">,
  () => string
>;

export function citationGraphReadiness(
  deps: GraphCitationsActionDeps,
): CitationGraphReadiness {
  if (!deps.app.internalPlugins.getEnabledPluginById(GRAPH_CORE_PLUGIN_ID)) {
    return "core-plugin-disabled";
  }
  return deps.bridge.runSync(deps.graphCitations.enabled)
    ? "ready"
    : "feature-off";
}

export function notifyCitationGraph(readiness: CitationGraphReadiness): void {
  if (readiness === "ready") return;
  Effect.runSyncWith(logServices)(
    Effect.logDebug("Citation Graph not opened").pipe(
      Effect.annotateLogs({ readiness }),
      withLogCategory("graph-citations"),
    ),
  );
  new BaseNotice(BLOCKED[readiness]());
}

function openable(deps: GraphCitationsActionDeps): boolean {
  const readiness = citationGraphReadiness(deps);
  notifyCitationGraph(readiness);
  return readiness === "ready";
}
