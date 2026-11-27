import { syntaxTree, tokenClassNodeProp } from "@codemirror/language";
import type { EditorState, StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { MarkdownView } from "obsidian";
import { editorLivePreviewField } from "obsidian";

export interface DocRange {
  from: number;
  to: number;
}

export function livePreviewOf(state: EditorState): boolean {
  return state.field(editorLivePreviewField, false) ?? false;
}

export function overlapsSelection(
  ranges: readonly DocRange[],
  from: number,
  to: number,
): boolean {
  return ranges.some((range) => range.from <= to && range.to >= from);
}

export function dispatchToMarkdownEditors(
  views: readonly MarkdownView[],
  effect: StateEffect<unknown>,
  options: { path?: string } = {},
): number {
  let reached = 0;
  for (const view of views) {
    if (options.path !== undefined && view.file?.path !== options.path) {
      continue;
    }
    view.editor.cm.dispatch({ effects: effect });
    reached += 1;
  }
  return reached;
}

export interface TokenNode {
  from: number;
  to: number;
  classes: readonly string[];
  text: string;
}

export function tokenNodes(state: EditorState, range: DocRange): TokenNode[] {
  const nodes: TokenNode[] = [];
  syntaxTree(state).iterate({
    from: range.from,
    to: range.to,
    enter(node) {
      const classes = node.type.prop(tokenClassNodeProp);
      if (classes === undefined) return;
      nodes.push({
        from: node.from,
        to: node.to,
        classes: classes.split(" "),
        text: state.doc.sliceString(node.from, node.to),
      });
    },
  });
  return nodes;
}

export function visibleLineRanges(view: EditorView): DocRange[] {
  const { doc } = view.state;
  const ranges: DocRange[] = [];
  for (const range of view.visibleRanges) {
    const from = doc.lineAt(range.from).from;
    const to = doc.lineAt(range.to).to;
    const last = ranges.at(-1);
    if (last !== undefined && from <= last.to) last.to = Math.max(last.to, to);
    else ranges.push({ from, to });
  }
  return ranges;
}
