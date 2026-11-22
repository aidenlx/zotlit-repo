import type { HoverAction } from "#core/citation-index/settings.ts";

import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";

import type { GestureSurface } from "./shell.ts";

export const CITEKEY_HOVER_SOURCE = "zotlit-citekey";

export type HoverEditingMode = "source" | "live-preview" | "reading";

export interface HoverPreferences {
  action: HoverAction;
  requireMod: Readonly<Record<HoverEditingMode, boolean>>;
}

export function hoverPreferences(
  settings: Pick<
    Readonly<Settings>,
    | "citation.hover-action"
    | "citation.hover-require-mod-source"
    | "citation.hover-require-mod-live-preview"
    | "citation.hover-require-mod-reading"
  >,
): HoverPreferences {
  return {
    action: settings["citation.hover-action"],
    requireMod: {
      source: settings["citation.hover-require-mod-source"],
      "live-preview": settings["citation.hover-require-mod-live-preview"],
      reading: settings["citation.hover-require-mod-reading"],
    },
  };
}

export interface CitationHoverGesture {
  pointerType: string | undefined;
  mod: boolean;
  mode: HoverEditingMode;
}

export type HoverSuppression =
  | "hover-off"
  | "not-a-mouse"
  | "needs-mod"
  | "no-works"
  | "not-direct";

export type CitationHoverIntent =
  | { kind: "popover"; citekeys: readonly string[] }
  | { kind: "page-preview"; citekey: string }
  | { kind: "nothing"; reason: HoverSuppression };

export function citationHoverIntent(
  gesture: CitationHoverGesture,
  hover: HoverPreferences,
  citekeys: readonly string[],
): CitationHoverIntent {
  if (hover.action === "off") {
    return { kind: "nothing", reason: "hover-off" };
  }
  if (gesture.pointerType !== undefined && gesture.pointerType !== "mouse") {
    return { kind: "nothing", reason: "not-a-mouse" };
  }
  if (hover.action === "page-preview") {
    if (citekeys.length === 0) return { kind: "nothing", reason: "no-works" };
    if (citekeys.length > 1) return { kind: "nothing", reason: "not-direct" };
    return { kind: "page-preview", citekey: citekeys[0]! };
  }
  if (hover.requireMod[gesture.mode] && !gesture.mod) {
    return { kind: "nothing", reason: "needs-mod" };
  }
  if (citekeys.length === 0) return { kind: "nothing", reason: "no-works" };
  return { kind: "popover", citekeys };
}

export function hoverEditingMode({
  surface,
  editorMode,
}: GestureSurface): HoverEditingMode {
  return surface === "reading" ? "reading" : (editorMode ?? "source");
}
