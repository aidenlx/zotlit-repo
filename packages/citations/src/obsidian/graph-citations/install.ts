import { Effect } from "effect";
import type {
  App,
  GraphData,
  GraphEngine,
  GraphNodeCallback,
  GraphRenderer,
  GraphView,
  HoverParent,
  LocalGraphView,
  WorkspaceLeaf,
} from "obsidian";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";

export const GRAPH_CORE_PLUGIN_ID = "graph";

export const GRAPH_VIEW_TYPES = ["graph", "localgraph"] as const;

export interface GraphLeafMembers {
  viewType: string;
  engine: GraphEngine & HoverParent & { app: App; render: () => unknown };
  renderer: GraphRenderer & {
    onNodeClick: GraphNodeCallback;
    onNodeRightClick: GraphNodeCallback;
    setData: (data: GraphData) => unknown;
    onNodeHover: GraphNodeCallback;
    onNodeUnhover: () => void;
    containerEl: HTMLElement;
    nodeLookup: Record<string, { x: number; y: number } | undefined>;
    scale: number;
    panX: number;
    panY: number;
  };
}

export function graphEngineOf(
  leaf: Pick<WorkspaceLeaf, "view">,
  viewType: string = leaf.view.getViewType(),
): GraphEngine | undefined {
  return viewType === "graph"
    ? (leaf.view as GraphView).dataEngine
    : viewType === "localgraph"
      ? (leaf.view as LocalGraphView).engine
      : undefined;
}

export function graphMembersOf(
  leaf: Pick<WorkspaceLeaf, "view">,
): GraphLeafMembers | null {
  const viewType = leaf.view.getViewType();
  const engine = graphEngineOf(leaf, viewType);
  const renderer = (leaf.view as GraphView).renderer;
  const present = membersPresent(
    "Graph leaf is missing an internal member; left native",
    {
      engine: Boolean(engine),
      "engine.app": Boolean(engine?.app),
      "engine.render": typeof engine?.render === "function",
      "engine.hoverPopover": engine ? "hoverPopover" in engine : false,
      renderer: Boolean(renderer),
      "renderer.onNodeClick": typeof renderer?.onNodeClick === "function",
      "renderer.onNodeRightClick":
        typeof renderer?.onNodeRightClick === "function",
      "renderer.setData": typeof renderer?.setData === "function",
      "renderer.onNodeHover": typeof renderer?.onNodeHover === "function",
      "renderer.onNodeUnhover": typeof renderer?.onNodeUnhover === "function",
      "renderer.containerEl": Boolean(renderer?.containerEl),
      "renderer.nodeLookup": Boolean(renderer?.nodeLookup),
      "renderer.scale": typeof renderer?.scale === "number",
      "renderer.panX": typeof renderer?.panX === "number",
      "renderer.panY": typeof renderer?.panY === "number",
    },
    { viewType },
  );
  return present ? ({ viewType, engine, renderer } as GraphLeafMembers) : null;
}

export function membersPresent(
  message: string,
  present: Record<string, boolean>,
  context: Record<string, unknown>,
): boolean {
  const missing = Object.keys(present).filter((member) => !present[member]);
  if (missing.length === 0) return true;
  Effect.runSyncWith(logServices)(
    Effect.logWarning(message).pipe(
      Effect.annotateLogs({ ...context, missing }),
      withLogCategory("graph-citations"),
    ),
  );
  return false;
}

export interface MemberProbe<T> {
  key: string;
  message: string;
  present: Record<string, boolean>;
  context: Record<string, unknown>;
  build: () => T;
}

const failures = new WeakMap<GraphEngine, Set<string>>();

export function targetOnce<T>(
  engine: GraphEngine,
  probe: MemberProbe<T>,
): T | null {
  const failed = failures.get(engine);
  if (failed?.has(probe.key)) return null;
  if (!membersPresent(probe.message, probe.present, probe.context)) {
    if (failed) failed.add(probe.key);
    else failures.set(engine, new Set([probe.key]));
    return null;
  }
  return probe.build();
}
