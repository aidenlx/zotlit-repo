import "@zotlit/annotations/desktop/annot-view/style.css";
import type { App, Plugin } from "obsidian";

import type { AnnotActions } from "@zotlit/annotations/desktop/annot-view/actions.tsx";
import type { AnnotViewModel } from "@zotlit/annotations/obsidian/annot-view/model.ts";
import type { AnnotState } from "@zotlit/annotations/obsidian/annot-view/state.ts";
import type { AnnotViewState } from "@zotlit/annotations/obsidian/annot-view/view-state.ts";
import type { ViewRegistryHandle } from "@zotlit/obsidian-kit/view-atoms.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { AnnotViewDeps } from "./view.tsx";
import { ANNOT_VIEW_TYPE, AnnotationView } from "./view.tsx";

type AnnotViewPlugin = Pick<
  Plugin,
  "registerView" | "addCommand" | "addRibbonIcon" | "app"
>;

export function registerAnnotView(
  plugin: AnnotViewPlugin,
  deps: AnnotViewDeps,
): void {
  plugin.registerView(
    ANNOT_VIEW_TYPE,
    (leaf) => new AnnotationView(leaf, deps),
  );

  const open = () => {
    void activateAnnotView(plugin.app);
  };

  plugin.addCommand({
    id: "open-annot-view",
    name: m.command_open_annot_view_name(),
    callback: open,
  });
  plugin.addRibbonIcon("highlighter", m.command_open_annot_view_name(), open);

  addFollowModeCommands(plugin, deps.registry, () => targetView(plugin.app));
}

export async function revealAnnotationInView(
  plugin: Pick<Plugin, "app">,
  annotationKey: string,
): Promise<void> {
  await activateAnnotView(plugin.app);
  targetView(plugin.app)?.revealAnnotation(annotationKey);
}

export async function showItemInAnnotView(
  app: App,
  itemKey: string,
): Promise<void> {
  await activateAnnotView(app);
  targetView(app)?.pinItem(itemKey);
}

export function annotationCardShown(app: App, annotationKey: string): boolean {
  return app.workspace
    .getLeavesOfType(ANNOT_VIEW_TYPE)
    .some(
      (leaf) =>
        leaf.view instanceof AnnotationView &&
        leaf.view.snapshot.annotations?.some(
          (record) => record.key === annotationKey,
        ) === true,
    );
}

export interface FollowModeCommandTarget {
  readonly model: Pick<AnnotViewModel, "state">;
  readonly snapshot: Pick<AnnotState, "pinnable">;
  readonly gestures: Pick<
    AnnotActions,
    "onSetFollowMode" | "onPinCurrentItem" | "onPinItem" | "onUnpin"
  > | null;
}

export function addFollowModeCommands(
  plugin: Pick<AnnotViewPlugin, "addCommand">,
  registry: ViewRegistryHandle,
  findView: () => FollowModeCommandTarget | null,
): void {
  type Gestures = NonNullable<FollowModeCommandTarget["gestures"]>;
  const command = ({
    id,
    name,
    applies,
    run,
  }: {
    id: string;
    name: string;
    applies: (
      state: AnnotViewState & FollowModeCommandTarget["snapshot"],
    ) => boolean;
    run: (gestures: Gestures) => void;
  }): void => {
    plugin.addCommand({
      id,
      name,
      checkCallback(checking) {
        const view = findView();
        if (!view?.gestures) return false;
        const state = {
          ...registry.get(view.model.state),
          pinnable: view.snapshot.pinnable,
        };
        if (!applies(state)) return false;
        if (!checking) run(view.gestures);
        return true;
      },
    });
  };

  command({
    id: "annot-view-follow-active-tab",
    name: m.command_annot_view_follow_active_tab_name(),
    applies: (state) => state.followMode !== "active-tab",
    run: (gestures) => gestures.onSetFollowMode("active-tab"),
  });
  command({
    id: "annot-view-follow-zotero-reader",
    name: m.command_annot_view_follow_zotero_reader_name(),
    applies: (state) => state.followMode !== "zotero-reader",
    run: (gestures) => gestures.onSetFollowMode("zotero-reader"),
  });
  command({
    id: "annot-view-pin-current-item",
    name: m.command_annot_view_pin_current_item_name(),
    applies: (state) =>
      state.followMode !== "pinned" && state.pinnable !== null,
    run: (gestures) => gestures.onPinCurrentItem(),
  });
  command({
    id: "annot-view-pin-item",
    name: m.command_annot_view_pin_item_name(),
    applies: () => true,
    run: (gestures) => gestures.onPinItem(),
  });
  command({
    id: "annot-view-unpin",
    name: m.command_annot_view_unpin_name(),
    applies: (state) => state.followMode === "pinned",
    run: (gestures) => gestures.onUnpin(),
  });
}

function targetView(app: App): AnnotationView | null {
  const active = app.workspace.getActiveViewOfType(AnnotationView);
  if (active) return active;
  const [leaf] = app.workspace.getLeavesOfType(ANNOT_VIEW_TYPE);
  const view = leaf?.view;
  return view instanceof AnnotationView ? view : null;
}

export async function activateAnnotView(app: App): Promise<void> {
  const { workspace } = app;
  let leaf = workspace.getLeavesOfType(ANNOT_VIEW_TYPE)[0];
  if (!leaf) {
    const right = workspace.getRightLeaf(false);
    if (!right) return;
    leaf = right;
    await leaf.setViewState({ type: ANNOT_VIEW_TYPE, active: true });
  }
  void workspace.revealLeaf(leaf);
}
