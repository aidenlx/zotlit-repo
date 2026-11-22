import { Menu } from "obsidian";

import { showMenuAtButton } from "@zotlit/obsidian-kit/menu.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { CITED_BY_SORT_GROUPS } from "./store.ts";
import type { CitedBySortMode } from "./store.ts";

const SORT_LABELS: Record<CitedBySortMode, () => string> = {
  alphabetical: m.cited_by_sort_alphabetical,
  alphabeticalReverse: m.cited_by_sort_alphabetical_reverse,
  byModifiedTime: m.cited_by_sort_modified_time,
  byModifiedTimeReverse: m.cited_by_sort_modified_time_reverse,
  byCreatedTime: m.cited_by_sort_created_time,
  byCreatedTimeReverse: m.cited_by_sort_created_time_reverse,
};

export function showSortMenu(
  button: HTMLElement,
  options: {
    readonly current: CitedBySortMode;
    readonly select: (mode: CitedBySortMode) => void;
  },
): void {
  const menu = new Menu().setNoIcon();
  for (const pair of CITED_BY_SORT_GROUPS) {
    for (const mode of pair) {
      menu.addItem((item) =>
        item
          .setTitle(SORT_LABELS[mode]())
          .setChecked(mode === options.current)
          .onClick(() => options.select(mode)),
      );
    }
    menu.addSeparator();
  }

  showMenuAtButton(menu, button);
}
