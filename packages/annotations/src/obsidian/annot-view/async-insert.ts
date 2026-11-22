import { isolateHistory } from "@codemirror/commands";
import {
  Compartment,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import type { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Editor, MarkdownFileInfo } from "obsidian";

import type { ObsidianEventEmitter } from "@zotlit/obsidian-kit/obsidian-event-source.ts";

const trimLineBreaks = (text: string) => text.replaceAll(/^\n+|\n+$/g, "");

function isBlockText(text: string): boolean {
  return trimLineBreaks(text).includes("\n");
}

const CLOSERS = new Set(".,;:!?)]}。，、；：！？）】」』》");

const OPENERS = new Set("([{“‘\"'「『（【");

function leadAfter(previous: string | null): string {
  return previous !== null && previous.trim() !== "" && !OPENERS.has(previous)
    ? " "
    : "";
}

function placeInline(
  text: string,
  around: { previous: string | null; next: string },
): { insert: string; cursor: number } {
  const lead = /^\s/u.test(text) ? "" : leadAfter(around.previous);
  if (/\s$/u.test(text)) {
    const insert = `${lead}${text}`;
    return { insert, cursor: insert.length };
  }
  if (around.next === " ") {
    const insert = `${lead}${text}`;
    return { insert, cursor: insert.length + 1 };
  }
  const insert = `${lead}${text}${CLOSERS.has(around.next) ? "" : " "}`;
  return { insert, cursor: insert.length };
}

export function isCitationCloser(char: string | undefined): boolean {
  return char === "]" || char === "】";
}

function placeCitation(
  citation: string,
  around: { previous: string | null; next: string },
): { insert: string; cursor: number } {
  const lead = leadAfter(around.previous);
  if (isCitationCloser(citation.at(-1))) {
    const insert = `${lead}${citation}`;
    return { insert, cursor: insert.length };
  }
  return {
    insert: `${lead}${citation}${around.next === " " ? "" : " "}`,
    cursor: lead.length + citation.length + 1,
  };
}

export interface Placement {
  kind?: "annotation" | "citation";
  replacesTrigger?: boolean;
}

export function placeInsertion(
  text: string,
  options: { doc: Text; range: { from: number; to: number } } & Placement,
): { insert: string; cursor: number } {
  const { doc, range } = options;
  const { from, to } = range;
  const around = {
    previous: options.replacesTrigger
      ? null
      : from === doc.lineAt(from).from
        ? ""
        : doc.sliceString(from - 1, from),
    next: doc.sliceString(to, to + 1),
  };
  if (options.kind === "citation") return placeCitation(text, around);
  if (!isBlockText(text)) return placeInline(trimLineBreaks(text), around);
  const block = trimLineBreaks(text);
  const isBlank = (line: number) =>
    line < 1 || line > doc.lines || doc.line(line).text.trim() === "";
  const start = doc.lineAt(from);
  const end = doc.lineAt(to);
  const before =
    doc.sliceString(start.from, from).trim() !== ""
      ? "\n\n"
      : isBlank(start.number - 1)
        ? ""
        : "\n";
  const after =
    doc.sliceString(to, end.to).trim() !== ""
      ? "\n\n"
      : isBlank(end.number + 1)
        ? ""
        : "\n";
  const insert = `${before}${block}${after}`;
  return { insert, cursor: insert.length };
}

export function watchInsertionWorkspace(workspace: ObsidianEventEmitter) {
  return (validate: () => void): (() => void) => {
    const refs = [
      workspace.on("active-leaf-change", validate),
      workspace.on("layout-change", validate),
    ];
    return () => {
      for (const ref of refs) workspace.offref(ref);
    };
  };
}

export function captureInsertion(options: {
  editor: Editor;
  info: MarkdownFileInfo;
  isCurrent: () => boolean;
  range?: { from: number; to: number };
  watchChanges: (validate: () => void) => () => void;
}) {
  const { editor, info } = options;
  const cm = editor.cm;
  const file = info.file;
  const path = file?.path;
  const initial = options.range ?? cm.state.selection.main;
  let cancelled = false;
  const cancelListeners = new Set<() => void>();
  const compartment = new Compartment();
  const marker = StateField.define<{ from: number; to: number } | null>({
    create: () => ({ from: initial.from, to: initial.to }),
    update(range, transaction) {
      if (!range || !transaction.docChanged) return range;
      let touched = false;
      transaction.changes.iterChangedRanges((from, to) => {
        if (
          range.from === range.to
            ? from <= range.from && to >= range.from
            : from < range.to && to > range.from
        )
          touched = true;
      });
      if (touched) return null;
      return {
        from: transaction.changes.mapPos(range.from, 1),
        to: transaction.changes.mapPos(
          range.to,
          range.from === range.to ? 1 : -1,
        ),
      };
    },
  });
  const cancelOnOverlap = EditorView.updateListener.of((update) => {
    if (update.state.field(marker, false) === null) cancel();
  });
  cm.dispatch({
    effects: StateEffect.appendConfig.of(
      compartment.of([marker, cancelOnOverlap]),
    ),
  });
  let settled = false;
  const valid = () =>
    !settled &&
    !cancelled &&
    !!file &&
    info.file === file &&
    file.path === path &&
    info.editor === editor &&
    editor.cm === cm &&
    cm.dom.isConnected &&
    options.isCurrent() &&
    cm.state.field(marker, false) != null;
  function cancel() {
    if (cancelled) return;
    cancelled = true;
    for (const listener of cancelListeners) listener();
    cancelListeners.clear();
  }
  const win = cm.dom.ownerDocument.defaultView;
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") cancel();
  };
  win?.addEventListener("keydown", onKey);
  const validate = () => {
    if (!valid()) cancel();
  };
  const stopWatching = options.watchChanges(validate);
  const dispose = (completed = false) => {
    if (settled) return;
    settled = true;
    if (!completed) cancel();
    cancelListeners.clear();
    win?.removeEventListener("keydown", onKey);
    stopWatching();
    if (!completed && cm.dom.isConnected)
      cm.dispatch({ effects: compartment.reconfigure([]) });
  };
  return {
    onCancel(listener: () => void): () => void {
      if (cancelled) {
        listener();
        return () => {};
      }
      cancelListeners.add(listener);
      return () => void cancelListeners.delete(listener);
    },
    valid,
    cancel,
    range: (): { from: number; to: number } | null =>
      cm.state.field(marker, false) ?? null,
    commit(text: string, placement: Placement = {}): boolean {
      if (!valid()) return false;
      const range = cm.state.field(marker)!;
      const { insert, cursor } = placeInsertion(text, {
        ...placement,
        doc: cm.state.doc,
        range,
      });
      cm.dispatch({
        effects: compartment.reconfigure([]),
        changes: { ...range, insert },
        selection: { anchor: range.from + cursor },
        annotations: [
          Transaction.userEvent.of("input.zotlit"),
          isolateHistory.of("full"),
        ],
      });
      dispose(true);
      return true;
    },
    [Symbol.dispose]: dispose,
  };
}
