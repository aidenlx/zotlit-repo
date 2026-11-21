// A link that starts Obsidian, staged for the End-to-end Run. Obsidian's main
// process sets `window.OBS_ACT` to the link data when the window has no
// dispatcher yet, and Obsidian dispatches it once the layout is ready. This
// plugin does the same with the link staged under LINK_KEY, and records the
// text of each notice the window shows from its load on.
import { Plugin } from "obsidian";

const LINK_KEY = "zotlit-e2e-launch-link";

export default class LaunchLinkPlugin extends Plugin {
  readonly notices: string[] = [];

  override onload(): void {
    const observer = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof HTMLElement && node.matches(".notice"))
            this.notices.push(node.textContent ?? "");
    });
    observer.observe(document.body, { childList: true, subtree: true });
    this.register(() => observer.disconnect());
    const staged = window.localStorage.getItem(LINK_KEY);
    if (staged === null) return;
    window.localStorage.removeItem(LINK_KEY);
    if (typeof Reflect.get(window, "OBS_ACT") !== "function")
      Reflect.set(window, "OBS_ACT", JSON.parse(staged));
  }
}
