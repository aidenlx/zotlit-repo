import { Keymap } from "obsidian";
import type { App, HoverParent, Workspace } from "obsidian";

import { CITEKEY_HOVER_SOURCE, hoverEditingMode } from "./hover.ts";
import type { CitationHoverGesture } from "./hover.ts";
import type { NavigationAction, NavigationGesture } from "./intent.ts";

export type GestureSurface = Pick<NavigationGesture, "surface" | "editorMode">;

export function mouseGesture(
  event: MouseEvent,
  action: NavigationAction,
  where: GestureSurface,
): NavigationGesture {
  const button =
    action === "hover" ? "none" : event.button === 1 ? "middle" : "left";
  return {
    action,
    button,
    mod: Keymap.isModifier(event, "Mod"),
    shift: event.shiftKey,
    alt: event.altKey,
    surface: where.surface,
    editorMode: where.editorMode,
    pane: button === "middle" ? "tab" : Keymap.isModEvent(event),
  };
}

export function hoverGesture(
  event: MouseEvent,
  where: GestureSurface,
): CitationHoverGesture {
  return {
    pointerType: (event as Partial<PointerEvent>).pointerType,
    mod: Keymap.isModifier(event, "Mod"),
    mode: hoverEditingMode(where),
  };
}

export interface CitekeyHoverLink {
  event: MouseEvent;
  hoverParent: HoverParent;
  targetEl: HTMLElement;
  linktext: string;
  sourcePath: string;
}

export function triggerCitekeyHover(
  workspace: Pick<Workspace, "trigger">,
  link: CitekeyHoverLink,
): void {
  workspace.trigger("hover-link", { ...link, source: CITEKEY_HOVER_SOURCE });
}

interface PagePreviewPlugin {
  options: Record<string, boolean>;
}

export function pagePreviewRequiresMod(app: App): boolean {
  const plugin = app.internalPlugins.getEnabledPluginById(
    "page-preview",
  ) as PagePreviewPlugin | null;
  const options = plugin?.options ?? {};
  if (Object.hasOwn(options, CITEKEY_HOVER_SOURCE))
    return options[CITEKEY_HOVER_SOURCE]!;
  return (
    app.workspace.hoverLinkSources[CITEKEY_HOVER_SOURCE]?.defaultMod ?? true
  );
}
