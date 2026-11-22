import type {
  FollowMenuAction,
  HeaderMenuAction,
  HeaderMenuEntry,
} from "#obsidian/annot-view/presentation.ts";
import type { Menu } from "obsidian";

import type { AnnotActions } from "./actions.tsx";

export type HeaderMenuGestures = Pick<
  AnnotActions,
  | "onAllowEditing"
  | "onChooseAttachment"
  | "onOpenPdf"
  | "onPinCurrentItem"
  | "onPinItem"
  | "onSetFollowMode"
  | "onUnpin"
>;

export interface HeaderMenuInput {
  groups: HeaderMenuEntry[][];
  actions: HeaderMenuGestures;
}

export function buildHeaderMenu(
  menu: Menu,
  { groups, actions }: HeaderMenuInput,
): void {
  groups.forEach((group, index) => {
    if (index > 0) menu.addSeparator();
    for (const entry of group) {
      menu.addItem((item) => {
        item.setTitle(entry.label);
        if (entry.icon !== undefined) item.setIcon(entry.icon);
        if (entry.report) item.setIsLabel(true);
        if (entry.disabled) item.setDisabled(true);
        if (entry.checked) item.setChecked(true);
        const { action } = entry;
        if (action !== undefined) {
          item.onClick(() => runHeaderAction(actions, action));
        }
      });
    }
  });
}

function runHeaderAction(
  actions: HeaderMenuGestures,
  action: HeaderMenuAction,
): void {
  switch (action.kind) {
    case "follow":
      runFollowModeAction(actions, action.follow);
      return;
    case "choose-attachment":
      actions.onChooseAttachment();
      return;
    case "open-pdf":
      actions.onOpenPdf();
      return;
    case "allow-editing":
      actions.onAllowEditing();
  }
}

function runFollowModeAction(
  actions: HeaderMenuGestures,
  action: FollowMenuAction,
): void {
  switch (action) {
    case "pin-current-item":
      actions.onPinCurrentItem();
      return;
    case "unpin":
      actions.onUnpin();
      return;
    case "choose-item":
      actions.onPinItem();
      return;
    default:
      actions.onSetFollowMode(action);
  }
}
