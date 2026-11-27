import type { Extension } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";

import type { Span } from "./span.ts";

export function gapsAround(
  { from, to }: Span,
  holes: readonly Span[],
  put: (from: number, to: number) => void,
): void {
  let start = from;
  for (const hole of holes) {
    if (hole.to <= start || hole.from >= to) continue;
    if (start < hole.from) put(start, hole.from);
    start = Math.max(start, hole.to);
  }
  if (start < to) put(start, to);
}

export function decorationLayer(
  build: (view: EditorView) => DecorationSet,
  {
    precedence = (extension) => extension,
    rebuild = (update) => update.docChanged,
  }: {
    precedence?: (extension: Extension) => Extension;
    rebuild?: (update: ViewUpdate) => boolean;
  } = {},
): Extension {
  const plugin = ViewPlugin.define((view) => ({
    decorations: build(view),
    update(update: ViewUpdate) {
      if (rebuild(update)) this.decorations = build(update.view);
    },
  }));
  return [
    plugin,
    precedence(
      EditorView.decorations.of(
        (view) => view.plugin(plugin)?.decorations ?? Decoration.none,
      ),
    ),
  ];
}
