import type { ChangeSpec } from "@codemirror/state";
import { diffChars } from "diff";
import type { TFile, Vault, Workspace } from "obsidian";
import {
  getFrontMatterInfo,
  MarkdownView,
  parseYaml,
  stringifyYaml,
  TextFileView,
} from "obsidian";

export type LiveTextApp = {
  vault: Pick<Vault, "process">;
  workspace: Pick<Workspace, "iterateAllLeaves">;
};

export function loadedTextFileView(
  app: { workspace: Pick<Workspace, "iterateAllLeaves"> },
  file: TFile,
  exclude?: TextFileView,
): TextFileView | null {
  let found: TextFileView | null = null;
  app.workspace.iterateAllLeaves((leaf) => {
    const view = leaf.view;
    if (
      found === null &&
      view !== exclude &&
      view instanceof TextFileView &&
      view.file === file &&
      view.lastSavedData !== null &&
      view.data !== null
    )
      found = view;
  });
  return found;
}

export async function readLiveText(
  app: {
    vault: Pick<Vault, "cachedRead">;
    workspace: Pick<Workspace, "iterateAllLeaves">;
  },
  file: TFile,
): Promise<string> {
  return (
    loadedTextFileView(app, file)?.getViewData() ??
    (await app.vault.cachedRead(file))
  );
}

export async function processLiveText(
  app: LiveTextApp,
  file: TFile,
  fn: (text: string) => string,
): Promise<void> {
  const view = loadedTextFileView(app, file);
  if (view !== null) {
    const text = view.getViewData();
    const next = fn(text);
    if (next === text) return;
    setViewDataKeepingScroll(view, next);
    if (view.getViewData() === next) {
      await view.save();
      return;
    }
    setViewDataKeepingScroll(view, text);
  }
  await app.vault.process(file, fn);
}

export function setViewDataKeepingScroll(
  view: TextFileView,
  text: string,
): void {
  const editor =
    view instanceof MarkdownView && view.getMode() === "source"
      ? view.editor.cm
      : null;
  const state = editor?.state;
  const scroll = editor?.scrollSnapshot();
  view.setViewData(text, false);
  if (!editor || !state || !scroll || state.doc === editor.state.doc) return;

  const changes: ChangeSpec[] = [];
  let offset = 0;
  for (const part of diffChars(
    state.doc.toString(),
    editor.state.doc.toString(),
  )) {
    if (part.added) changes.push({ from: offset, insert: part.value });
    else {
      if (part.removed)
        changes.push({ from: offset, to: offset + part.value.length });
      offset += part.value.length;
    }
  }
  const mapped = scroll.map(state.changes(changes));
  if (mapped) editor.dispatch({ effects: mapped });
}

export function parseFrontMatter(text: string): Record<string, unknown> {
  const info = getFrontMatterInfo(text);
  const parsed: unknown = info.exists ? parseYaml(info.frontmatter) : {};
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : {};
}

export function spliceFrontMatter(
  text: string,
  frontmatter: Record<string, unknown>,
): string {
  const info = getFrontMatterInfo(text);
  if (Object.keys(frontmatter).length === 0)
    return info.exists ? text.slice(info.contentStart) : text;
  const yaml = stringifyYaml(frontmatter);
  return info.exists
    ? text.slice(0, info.from) + yaml + text.slice(info.to)
    : `---\n${yaml}---\n${text}`;
}

export function processLiveFrontMatter(
  app: LiveTextApp,
  file: TFile,
  fn: (frontmatter: Record<string, unknown>) => void,
): Promise<void> {
  return processLiveText(app, file, (text) => {
    const frontmatter = parseFrontMatter(text);
    fn(frontmatter);
    return spliceFrontMatter(text, frontmatter);
  });
}
