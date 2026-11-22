import type { MarkdownFileInfo, MarkdownView } from "obsidian";

export function lastEditor(
  views: readonly MarkdownView[],
  active: string | undefined,
  recent: readonly string[],
): MarkdownFileInfo | null {
  const editors = new Map<string, MarkdownView>();
  for (const view of views) {
    if (view.getMode() === "source" && view.file)
      editors.set(view.file.path, view);
  }
  for (const path of [...(active === undefined ? [] : [active]), ...recent]) {
    const view = editors.get(path);
    if (view) return view;
  }
  return null;
}
