import type { PdfReader, ReaderCommand, ReaderState } from "#/core/index.ts";
import type { Scope } from "obsidian";
import { Keymap } from "obsidian";

const TEXT_ENTRY = "input, textarea, select, [contenteditable]";

function inTextEntry(event: KeyboardEvent): boolean {
  const target = event.targetNode;
  return Boolean(target?.instanceOf(HTMLElement) && target.closest(TEXT_ENTRY));
}

function plain(event: KeyboardEvent): boolean {
  return !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
}

function commandOf(
  event: KeyboardEvent,
  state: ReaderState,
): ReaderCommand | null {
  if (event.isComposing || event.keyCode === 229) return null;
  switch (event.key) {
    case "ArrowLeft":
    case "ArrowRight": {
      const fit = state.zoom === "page-width" || state.zoom === "page-height";
      if (!fit || !plain(event) || inTextEntry(event)) return null;
      return event.key === "ArrowLeft" ? "previous-page" : "next-page";
    }
    case "Escape":
      return plain(event) ? "escape" : null;
    case "F3":
      if (!state.find.open || event.ctrlKey || event.metaKey || event.altKey)
        return null;
      return event.shiftKey ? "find-previous" : "find-next";
    case "g":
    case "G":
      if (!state.find.open || !Keymap.isModifier(event, "Mod") || event.altKey)
        return null;
      return event.shiftKey ? "find-previous" : "find-next";
    default:
      return null;
  }
}

export function bindReaderKeys(
  scope: Scope,
  reader: () => PdfReader | null,
): void {
  scope.register(null, null, (event) => {
    const current = reader();
    if (!current) return;
    const command = commandOf(event, current.state.get());
    if (command && current.command(command)) return false;
  });
}
