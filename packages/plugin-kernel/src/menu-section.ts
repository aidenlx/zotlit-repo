export const MENU_SECTION = {
  pane: "pane",
  open: "open",
  create: "action-primary",
  action: "action",
  info: "info",
  view: "view",
  danger: "danger",
} as const;

export type MenuSection = (typeof MENU_SECTION)[keyof typeof MENU_SECTION];
