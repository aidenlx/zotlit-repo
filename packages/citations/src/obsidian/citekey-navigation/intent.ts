import type { PaneType } from "obsidian";

export type NavigationPane = boolean | PaneType;
export type NavigationAction = "click" | "hover";
export type NavigationButton = "left" | "middle" | "none";
export type EditorMode = "source" | "live-preview";
export type NavigationSurface = "editor" | "reading";

export interface NavigationGesture {
  action: NavigationAction;
  button: NavigationButton;
  mod: boolean;
  shift: boolean;
  alt: boolean;
  editorMode?: EditorMode;
  surface: NavigationSurface;
  pane?: NavigationPane;
}

export type NavigationTarget =
  | { resolution: "direct"; citekey: string }
  | { resolution: "open-or-create"; citekey: string }
  | { resolution: "citation-menu"; citekeys: readonly string[] }
  | { resolution: "unavailable" };

export interface HoveredWork {
  citekey: string;
  indexedKey?: string;
}

export interface CitedWork extends HoveredWork {
  label: string;
}

export function citationTarget(works: readonly CitedWork[]): NavigationTarget {
  if (works.length === 0) return { resolution: "unavailable" };
  if (works.length === 1) {
    return { resolution: "open-or-create", citekey: works[0]!.citekey };
  }
  return {
    resolution: "citation-menu",
    citekeys: works.map((work) => work.citekey),
  };
}

export type CitationClickIntent = "navigate" | "edit" | "nothing";

export function citationClickIntent(
  gesture: Pick<
    NavigationGesture,
    "action" | "button" | "mod" | "editorMode" | "surface"
  >,
): CitationClickIntent {
  if (gesture.action !== "click") return "nothing";
  if (gesture.button !== "left") return "nothing";
  if (gesture.mod) return "navigate";
  return gesture.surface === "editor" && gesture.editorMode === "live-preview"
    ? "edit"
    : "nothing";
}

export type NavigationIntent =
  | { kind: "open"; citekey: string; pane: NavigationPane }
  | {
      kind: "show-citation-menu";
      citekeys: readonly string[];
      pane: NavigationPane;
    }
  | { kind: "hover"; citekey: string }
  | { kind: "nothing" };

export function navigationPane(
  gesture: Pick<NavigationGesture, "button" | "mod" | "shift" | "alt">,
): NavigationPane {
  if (gesture.button === "middle") return "tab";
  if (!gesture.mod) return false;
  if (gesture.alt && gesture.shift) return "window";
  if (gesture.alt) return "split";
  return "tab";
}

export function navigationIntent(
  gesture: NavigationGesture,
  target: NavigationTarget,
): NavigationIntent {
  if (gesture.action === "hover") {
    return target.resolution === "direct"
      ? { kind: "hover", citekey: target.citekey }
      : { kind: "nothing" };
  }

  if (gesture.button === "none") return { kind: "nothing" };

  if (
    gesture.surface === "editor" &&
    gesture.editorMode === "source" &&
    gesture.button === "left" &&
    !gesture.mod
  ) {
    return { kind: "nothing" };
  }

  const pane = gesture.pane ?? navigationPane(gesture);
  switch (target.resolution) {
    case "direct":
    case "open-or-create":
      if (isSourceModeSameTabDowngrade(gesture, pane)) {
        return { kind: "open", citekey: target.citekey, pane: false };
      }
      return { kind: "open", citekey: target.citekey, pane };
    case "citation-menu":
      return {
        kind: "show-citation-menu",
        citekeys: target.citekeys,
        pane,
      };
    case "unavailable":
      return { kind: "nothing" };
  }
}

function isSourceModeSameTabDowngrade(
  gesture: NavigationGesture,
  pane: NavigationPane,
): boolean {
  return (
    gesture.surface === "editor" &&
    gesture.editorMode === "source" &&
    gesture.button === "left" &&
    gesture.mod &&
    !gesture.shift &&
    pane === "tab"
  );
}
