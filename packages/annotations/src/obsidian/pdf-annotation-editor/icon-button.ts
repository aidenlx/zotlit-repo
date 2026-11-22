import { setIcon, setTooltip } from "obsidian";
import type { IconName } from "obsidian";

import { onActivateKey } from "@zotlit/obsidian-kit/utils.ts";

export interface IconButtonSpec {
  icon: IconName;
  tooltip: string;
  color?: string | null;
  pressed?: boolean | null;
  disabled?: boolean;
}

export function renderIconButton(
  parent: HTMLElement,
  spec: IconButtonSpec,
  activate: (node: HTMLElement) => void,
): HTMLElement {
  const node = parent.createDiv({
    cls: "clickable-icon",
    attr: { role: "button", tabindex: "0" },
  });
  updateIconButton(node, spec);
  if (spec.disabled) return node;
  node.addEventListener("click", () => activate(node));
  node.addEventListener("keydown", (event) =>
    onActivateKey(event, () => activate(node)),
  );
  return node;
}

const drawnIcons = new WeakMap<HTMLElement, IconName>();

export function updateIconButton(
  node: HTMLElement,
  {
    icon,
    tooltip,
    color = null,
    pressed = null,
    disabled = false,
  }: IconButtonSpec,
): void {
  setTooltip(node, tooltip);
  if (drawnIcons.get(node) !== icon) {
    setIcon(node, icon);
    drawnIcons.set(node, icon);
  }
  node.style.color = color ?? "";
  if (pressed === null) {
    node.removeClass("is-active");
    node.removeAttribute("aria-pressed");
  } else {
    node.classList.toggle("is-active", pressed);
    node.setAttribute("aria-pressed", String(pressed));
  }
  node.classList.toggle("is-disabled", disabled);
  if (disabled) node.setAttribute("aria-disabled", "true");
  else node.removeAttribute("aria-disabled");
}
