import { MarkdownView } from "obsidian";
import type { MarkdownFileInfo, Workspace } from "obsidian";

export function lastEditor(
  workspace: Pick<
    Workspace,
    "getActiveFile" | "getLastOpenFiles" | "iterateAllLeaves"
  >,
): MarkdownFileInfo | null {
  const editors = new Map<string, MarkdownView>();
  workspace.iterateAllLeaves(({ view }) => {
    if (
      view instanceof MarkdownView &&
      view.getMode() === "source" &&
      view.file
    )
      editors.set(view.file.path, view);
  });
  const active = workspace.getActiveFile()?.path;
  for (const path of [
    ...(active === undefined ? [] : [active]),
    ...workspace.getLastOpenFiles(),
  ]) {
    const view = editors.get(path);
    if (view) return view;
  }
  return null;
}
