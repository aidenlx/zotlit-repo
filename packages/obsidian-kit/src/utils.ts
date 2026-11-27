import type { ClassValue } from "cn";
import { clsx } from "cn";
import type { TooltipOptions } from "obsidian";
import type { KeyboardEvent, MouseEvent } from "react";

import { twMerge } from "@zotlit/plugin-kernel/tw.ts";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface TooltipAttrs {
  "aria-label": string;
  "data-tooltip-position"?: NonNullable<TooltipOptions["placement"]>;
  "data-tooltip-classes"?: string;
  "data-tooltip-delay"?: number;
}

export function tooltipAttrs(
  text: string,
  options?: TooltipOptions,
): TooltipAttrs {
  const attrs: TooltipAttrs = { "aria-label": text };
  if (options?.placement && options.placement !== "bottom") {
    attrs["data-tooltip-position"] = options.placement;
  }
  if (options?.classes?.length) {
    attrs["data-tooltip-classes"] = options.classes.join(" ");
  }
  if (options?.delay) {
    attrs["data-tooltip-delay"] = options.delay;
  }
  return attrs;
}

export function onActivateKey(
  e: Pick<KeyboardEvent, "key" | "preventDefault">,
  activate: () => void,
) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    activate();
  }
}

export function activatable(
  activate: () => void,
  { disabled }: { disabled?: boolean } = {},
) {
  return {
    role: "button" as const,
    tabIndex: disabled ? -1 : 0,
    onClick: (e: MouseEvent) => {
      e.stopPropagation();
      if (disabled) return;
      activate();
    },
    onKeyDown: (e: KeyboardEvent) => {
      e.stopPropagation();
      if (disabled) return;
      onActivateKey(e, activate);
    },
  };
}

const claimedClicks = new WeakSet<Event>();

export function claimClick(e: { nativeEvent: Event }): void {
  claimedClicks.add(e.nativeEvent);
}

export function clickClaimed(e: { nativeEvent: Event }): boolean {
  return claimedClicks.has(e.nativeEvent);
}
