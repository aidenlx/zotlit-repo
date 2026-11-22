import type { WorkspaceLeaf } from "obsidian";

import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { MENU_SECTION } from "@zotlit/plugin-kernel/menu-section.ts";
import type { FileMenuSegment } from "@zotlit/plugin-services/obsidian/file-menu.ts";

import {
  HISTORY_DIRECTIONS,
  historyCommandName,
  historyStands,
} from "./actions.ts";
import type { HistorySurface } from "./actions.ts";
import type { HistoryDirection } from "./history.ts";
import type { AnnotationRepository } from "./service.ts";

const ICONS: Readonly<Record<HistoryDirection, string>> = {
  undo: "undo-2",
  redo: "redo-2",
};

export interface AnnotationHistoryMenuDeps {
  annotations: Pick<AnnotationRepository["Service"], "canRedo" | "canUndo">;
  bridge: Pick<EffectBridge, "runSync">;
  surfaceFor: (leaf: WorkspaceLeaf) => HistorySurface | null;
}

export function annotationHistoryFileMenu(
  deps: AnnotationHistoryMenuDeps,
): FileMenuSegment {
  return (menu, { source, leaf }) => {
    if (source !== "more-options" || !leaf) return;
    const surface = deps.surfaceFor(leaf);
    const attachmentKey = surface?.historyAttachment ?? null;
    if (!surface || attachmentKey === null) return;

    for (const direction of HISTORY_DIRECTIONS) {
      menu.addItem((item) =>
        item
          .setSection(MENU_SECTION.action)
          .setTitle(historyCommandName(direction))
          .setIcon(ICONS[direction])
          .setDisabled(
            !historyStands({
              annotations: deps.annotations,
              bridge: deps.bridge,
              attachmentKey,
              direction,
            }),
          )
          .onClick(() => surface.stepHistory(direction)),
      );
    }
  };
}
