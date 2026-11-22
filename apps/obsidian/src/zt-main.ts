import type { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { shellEntry } from "@zotlit/plugin-shell/obsidian/entry.ts";

import { linkActions } from "./link-actions.ts";
import "./zt-main.css";

export default class ZotLitPlugin extends shellEntry(
  async () => (await import("./zt-body.ts")).start,
  "layout-ready",
  linkActions,
) {
  async showInstallerUpdateNotice(): Promise<BaseNotice> {
    return (await import("./zt-body.ts")).showInstallerUpdateNotice();
  }
}
