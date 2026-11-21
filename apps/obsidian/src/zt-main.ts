// The plugin class Obsidian loads. It loads the body (`zt-body.ts`) once the
// layout is ready, so `main.js` evaluates only this entry at the app's start.
import type { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { shellEntry } from "@zotlit/plugin-shell/obsidian/entry.ts";

import { linkActions } from "./link-actions.ts";
import "./zt-main.css";

/** Desktop ZotLit: the shell entry over the body in `zt-body.ts`. */
export default class ZotLitPlugin extends shellEntry(
  async () => (await import("./zt-body.ts")).start,
  "layout-ready",
  linkActions,
) {
  /** Show the installer notice independently of the version check. */
  async showInstallerUpdateNotice(): Promise<BaseNotice> {
    return (await import("./zt-body.ts")).showInstallerUpdateNotice();
  }
}
