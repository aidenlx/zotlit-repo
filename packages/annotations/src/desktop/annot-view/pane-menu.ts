import type { HeaderMenuState } from "#obsidian/annot-view/presentation.ts";
import type { Menu } from "obsidian";

import * as m from "@zotlit/plugin-messages/messages.ts";

import type { AnnotActions } from "./actions.tsx";
import { buildHeaderMenu } from "./menus.ts";

import { headerMenu } from "#obsidian/annot-view/presentation.ts";

export interface PaneMenuInput {
  state: HeaderMenuState;
  actions: AnnotActions;
  now: Temporal.Instant;
  query?: (menu: Menu) => void;
}

export function buildPaneMenu(
  menu: Menu,
  { state, actions, now, query }: PaneMenuInput,
): void {
  buildHeaderMenu(menu, { groups: headerMenu(state, now), actions });

  if (query) {
    menu.addSeparator();
    query(menu);
  }

  menu.addSeparator();
  menu.addItem((item) =>
    item
      .setTitle(m.annot_view_refresh_data())
      .setIcon("refresh-cw")
      .onClick(() => actions.onRefresh()),
  );
}
