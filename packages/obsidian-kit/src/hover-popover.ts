import { HoverPopover as ObsidianHoverPopover } from "obsidian";

export class HoverPopover extends ObsidianHoverPopover {
  protected homeDocument(): Document | null {
    return null;
  }

  override position(): void {
    const owner = this.targetEl
      ? null
      : (this.homeDocument() ?? this.hoverEl.parentElement?.doc);
    if (!owner || owner === activeDocument) {
      super.position();
      return;
    }
    const focused = activeDocument;
    activeDocument = owner;
    try {
      super.position();
    } finally {
      activeDocument = focused;
    }
  }

  showNow(): void {
    // oxlint-disable-next-line zotlit-obsidian/no-global-timer -- Obsidian arms the wait on the main window.
    window.clearTimeout(this.timer);
    this.show();
  }
}
