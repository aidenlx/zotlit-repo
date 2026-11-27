import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import * as m from "@zotlit/plugin-messages/messages.ts";

import type { WorkbenchModel } from "./model.ts";
import type {
  HandleSizing,
  PanelBounds,
  PanelHandle,
  PanelResize,
  WorkbenchPanels,
} from "./panel-layout.ts";
import {
  canResizePanel,
  PANEL_HANDLES,
  PANEL_SIDES,
  panelHandles,
  resizePanel,
} from "./panel-layout.ts";

export interface PanelSizeItem {
  readonly handle: PanelHandle;
  readonly resize: PanelResize;
  readonly label: string;
  readonly disabled: boolean;
  readonly apply: (panels: WorkbenchPanels) => WorkbenchPanels;
}

export interface PanelSizeMenu {
  readonly handle: PanelHandle;
  readonly axis: HandleSizing["axis"];
  readonly label: string;
  readonly items: readonly PanelSizeItem[];
}

const RESIZES: readonly PanelResize[] = ["grow", "shrink", "reset"];

export function panelSizeMenus(
  panels: WorkbenchPanels,
  bounds: PanelBounds,
): readonly PanelSizeMenu[] {
  return panelHandles(panels, bounds.size).map((handle) => {
    const { axis, side } = PANEL_HANDLES[handle];
    const labels =
      axis === "vertical"
        ? {
            grow: m.workbench_panel_taller(),
            shrink: m.workbench_panel_shorter(),
            reset: m.workbench_panel_reset_height(),
          }
        : {
            grow: m.workbench_panel_wider(),
            shrink: m.workbench_panel_narrower(),
            reset: m.workbench_panel_reset_width(),
          };
    return {
      handle,
      axis,
      label: PANEL_SIDES[side].resizeLabel(),
      items: RESIZES.map((resize) => ({
        handle,
        resize,
        label: labels[resize],
        disabled: !canResizePanel(handle, resize, bounds)(panels),
        apply: resizePanel(handle, resize, bounds),
      })),
    };
  });
}

export function pickPanelSize(
  registry: AtomRegistry.AtomRegistry,
  model: Pick<WorkbenchModel, "panels" | "sizedFromMenu">,
  item: PanelSizeItem,
): void {
  registry.update(model.panels, item.apply);
  registry.set(model.sizedFromMenu, item.handle);
}
