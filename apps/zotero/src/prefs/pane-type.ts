import type { PaneType } from "@zotlit/protocol";

import { prefs } from "./index.ts";

const ACTIVE_TAB = "active";

const PANE_TYPES = new Set<string>(["tab", "split", "window"]);

export function preferredPaneType(): PaneType | undefined {
  const stored = prefs.get<string>("extensions.zotlit.pane-type");
  if (typeof stored !== "string" || stored === ACTIVE_TAB) return undefined;
  return PANE_TYPES.has(stored) ? (stored as PaneType) : undefined;
}
