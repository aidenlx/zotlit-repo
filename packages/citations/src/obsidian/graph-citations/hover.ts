import type {
  CitationPopover,
  WorkHoverRequest,
} from "#obsidian/citation-popover/service.ts";
import type { NavigationPane } from "#obsidian/citekey-navigation/index.ts";
import { Effect } from "effect";
import { around } from "monkey-around";
import type { GraphData, MetadataCache, Workspace } from "obsidian";
import { Keymap, PopoverState } from "obsidian";

import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import {
  withLogCategory,
  logLevelEnabled,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { itemKeyFromFrontmatter } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import type { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import type { GraphCitationAdditions } from "./adapter.ts";
import { CITATION_POPOVER } from "./display.ts";
import type { GraphLeafMembers } from "./install.ts";
import { rowFlag } from "./rows.ts";

import {
  hoverPreferences,
  triggerCitekeyHover,
} from "#obsidian/citekey-navigation/index.ts";
import "./style.css";

interface PopoverBridge {
  runAndForget: EffectBridge["runAndForget"];
  runSync: EffectBridge["runSync"];
}

export interface NodeHoverDeps {
  workspace: Pick<Workspace, "trigger">;
  metadataCache: Pick<MetadataCache, "getCache">;
  settings: Pick<PluginSettings["Service"], "current">;
  citationPopover: Pick<CitationPopover["Service"], "showWork" | "hide">;
  bridge: PopoverBridge;
  open: (indexedKey: string, pane: NavigationPane) => void;
}

interface NodeHoverContext {
  members: GraphLeafMembers;
  deps: NodeHoverDeps;
  stand: NodeStand;
  additions: () => GraphCitationAdditions;
}

export function wrapNodeHover(
  members: GraphLeafMembers,
  deps: NodeHoverDeps,
  additions: () => GraphCitationAdditions,
): Disposable {
  const { renderer } = members;
  const stand = new NodeStand(members, deps.citationPopover, deps.bridge);
  const context: NodeHoverContext = { members, deps, stand, additions };
  const stack = new DisposableStack();
  stack.defer(
    around(renderer, {
      onNodeHover: (native) => (evt, id, type) => {
        if (!hoverNode(context, evt, id)) native(evt, id, type);
      },
      onNodeUnhover: (native) => () => {
        stand.release();
        native();
        stand.retire();
      },
      setData: (native) => (data) => {
        const result = native(data);
        const enabled = rowFlag(members.engine, CITATION_POPOVER, false);
        stand.retainNodes(enabled ? data.nodes : {});
        if (!enabled) stand.release();
        return result;
      },
    }),
  );
  stack.use(stand);
  return stack;
}

function hoverNode(
  { additions, stand, deps, members }: NodeHoverContext,
  evt: MouseEvent,
  id: string,
): boolean {
  if (!rowFlag(members.engine, CITATION_POPOVER, false)) return false;
  const settings = deps.bridge.runSync(deps.settings.current);
  const drawn = additions();
  const node = hoveredNode(id, drawn, deps);
  if (node === null) return false;
  const { action } = hoverPreferences(settings);
  if (action === "off") return false;
  const { pointerType } = evt as Partial<PointerEvent>;
  if (pointerType !== undefined && pointerType !== "mouse") {
    if (logLevelEnabled("trace"))
      deps.bridge.runSync(
        Effect.logTrace("Graph node hover suppressed").pipe(
          Effect.annotateLogs({ id, reason: "not-a-mouse" }),
          withLogCategory("graph-citations"),
        ),
      );
    return true;
  }
  if (
    action === "popover" &&
    settings["citation.hover-require-mod-graph"] &&
    !Keymap.isModifier(evt, "Mod")
  ) {
    if (logLevelEnabled("trace"))
      deps.bridge.runSync(
        Effect.logTrace("Graph node hover suppressed").pipe(
          Effect.annotateLogs({ id, reason: "needs-mod" }),
          withLogCategory("graph-citations"),
        ),
      );
    return true;
  }
  const position = nodeScreenPosition(members.renderer, id);
  if (position === null) {
    deps.bridge.runSync(
      Effect.logWarning(
        "Graph node has no place in the renderer; hover left native",
      ).pipe(
        Effect.annotateLogs({
          id,
        }),
        withLogCategory("graph-citations"),
      ),
    );
    return false;
  }
  if (action === "page-preview") {
    if (node.work.kind === "citekey") return true;
    triggerCitekeyHover(deps.workspace, {
      event: evt,
      hoverParent: members.engine,
      targetEl: stand.take(position, id),
      linktext: node.id,
      sourcePath: "",
    });
    return true;
  }
  if (logLevelEnabled("debug"))
    deps.bridge.runSync(
      Effect.logDebug("Graph node shows its entry").pipe(
        Effect.annotateLogs({ id, work: node.work }),
        withLogCategory("graph-citations"),
      ),
    );
  deps.bridge.runAndForget(
    deps.citationPopover.showWork({
      event: evt,
      hoverParent: members.engine,
      targetEl: stand.take(position, id),
      work: node.work,
      open: deps.open,
    }),
  );
  return true;
}

interface HoveredNode {
  id: string;
  work: WorkHoverRequest["work"];
}

function hoveredNode(
  id: string,
  additions: GraphCitationAdditions,
  deps: NodeHoverDeps,
): HoveredNode | null {
  const citekey = additions.citedWorkNodes.get(id);
  if (citekey !== undefined) return { id, work: { kind: "citekey", citekey } };
  const indexedKey = itemKeyFromFrontmatter(deps.metadataCache.getCache(id));
  return indexedKey === null
    ? null
    : { id, work: { kind: "item", indexedKey } };
}

interface NodePosition {
  left: number;
  top: number;
}

function nodeScreenPosition(
  renderer: GraphLeafMembers["renderer"],
  id: string,
): NodePosition | null {
  const { nodeLookup, scale, panX, panY, containerEl } = renderer;
  const node = nodeLookup[id];
  if (!node) return null;
  const ratio = containerEl.win.devicePixelRatio;
  return {
    left: (node.x * scale + panX) / ratio,
    top: (node.y * scale + panY) / ratio,
  };
}

const HOLD_INTERVAL_MS = 200;

const HOLD_WAIT_MS = 2000;

class NodeStand implements Disposable {
  readonly #members: GraphLeafMembers;
  readonly #citationPopover;
  readonly #anchors = new Map<HTMLElement, string>();
  #hold = 0;
  #holdWin: Window | null = null;

  readonly bridge: Pick<PopoverBridge, "runSync">;

  constructor(
    members: GraphLeafMembers,
    citationPopover: Pick<CitationPopover["Service"], "hide">,
    bridge: Pick<PopoverBridge, "runSync">,
  ) {
    this.bridge = bridge;

    this.#members = members;
    this.#citationPopover = citationPopover;
  }

  take(position: NodePosition, id: string): HTMLElement {
    this.retire();
    const element = this.#build();
    element.style.left = `${position.left}px`;
    element.style.top = `${position.top}px`;
    this.#anchors.set(element, id);
    this.#startHold(element);
    return element;
  }

  release(): void {
    if (this.#hold === 0) return;
    this.#holdWin?.clearInterval(this.#hold);
    this.#hold = 0;
    this.#holdWin = null;
  }

  retire(): void {
    const standing = this.#members.engine.hoverPopover?.targetEl ?? null;
    for (const anchor of this.#anchors.keys()) {
      if (anchor === standing) continue;
      anchor.remove();
      this.#anchors.delete(anchor);
    }
  }

  retainNodes(nodes: GraphData["nodes"]): void {
    for (const [anchor, id] of this.#anchors) {
      if (Object.hasOwn(nodes, id)) continue;
      this.bridge.runSync(
        this.#citationPopover.hide(this.#members.engine, anchor),
      );
      const popover = this.#members.engine.hoverPopover;
      if (popover?.targetEl === anchor) popover.hide();
      anchor.remove();
      this.#anchors.delete(anchor);
    }
  }

  [Symbol.dispose](): void {
    this.release();
    this.bridge.runSync(this.#citationPopover.hide(this.#members.engine));
    const popover = this.#members.engine.hoverPopover;
    if (popover?.targetEl && this.#anchors.has(popover.targetEl))
      popover.hide();
    for (const anchor of this.#anchors.keys()) anchor.remove();
    this.#anchors.clear();
  }

  #startHold(anchor: HTMLElement): void {
    this.release();
    const { engine, renderer } = this.#members;
    let stood = false;
    let waited = 0;
    const win = renderer.containerEl.win;
    this.#holdWin = win;
    this.#hold = win.setInterval(() => {
      const popover = engine.hoverPopover;
      if (!this.#anchors.has(anchor)) {
        this.release();
        return;
      }
      if (
        !popover ||
        popover.targetEl !== anchor ||
        popover.state === PopoverState.Hidden
      ) {
        waited += HOLD_INTERVAL_MS;
        if (stood || waited > HOLD_WAIT_MS) this.release();
        return;
      }
      stood = true;
      popover.onTarget = true;
      popover.transition();
    }, HOLD_INTERVAL_MS);
  }

  #build(): HTMLElement {
    return this.#members.renderer.containerEl.createDiv(
      "zt-graph-hover-anchor",
    );
  }
}
