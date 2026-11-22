import type { CapabilityAffordance } from "#obsidian/annotation-repository/capability-copy.ts";
import { setIcon } from "obsidian";

import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";

const LAYOUT_CLASSES = ["zt:flex", "zt:items-center", "zt:gap-1"];

const EDIT_GESTURE_KEYS = new Set([
  "h",
  "u",
  "c",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
]);

export function renderCapabilityAffordance(
  slot: HTMLElement,
  affordance: CapabilityAffordance | null,
): HTMLElement | null {
  if (affordance === null) {
    removeCapabilityAffordance(slot);
    return null;
  }
  const { icon, tone, label, spinning, countdown } = affordance;
  const held = affordanceIn(slot);
  const node =
    held ??
    slot.createDiv({
      cls: [
        themeHook.pdfCapability,
        ...LAYOUT_CLASSES,
        "zt:text-muted-foreground",
      ],
      attr: { role: "status" },
    });
  if (!held) setIcon(node, icon);
  node.dataset.ztCapabilityTone = tone;
  node.classList.toggle("mod-warning", tone === "warning");
  if (spinning) node.setAttribute("aria-busy", "true");
  else node.removeAttribute("aria-busy");

  if (held) {
    node
      .querySelectorAll(
        "[data-zt-capability-label], [data-zt-capability-countdown]",
      )
      .forEach((child) => child.remove());
    setIcon(node, icon);
  }
  if (spinning) node.querySelector("svg")?.classList.add("zt:animate-spin");
  node.createSpan({
    text: label,
    attr: { "data-zt-capability-label": "" },
  });
  if (countdown !== null) {
    node.createSpan({
      cls: "zt:text-xs zt:tabular-nums",
      text: String(countdown),
      attr: { "data-zt-capability-countdown": "" },
    });
  }
  return node;
}

export function removeCapabilityAffordance(slot: HTMLElement): void {
  affordanceIn(slot)?.remove();
}

export function isEditGesture(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (!EDIT_GESTURE_KEYS.has(event.key.toLowerCase())) return false;
  return !inTextEntry(event.target);
}

function affordanceIn(slot: HTMLElement): HTMLElement | null {
  return slot.querySelector<HTMLElement>(
    `:scope > .${themeHook.pdfCapability}`,
  );
}

export function inTextEntry(target: EventTarget | null): boolean {
  const node = target as Node | null;
  if (!node?.instanceOf(HTMLElement)) return false;
  return (
    node.instanceOf(HTMLInputElement) ||
    node.instanceOf(HTMLTextAreaElement) ||
    node.instanceOf(HTMLSelectElement) ||
    node.isContentEditable
  );
}
