import type { EditorView } from "@codemirror/view";

export function onEditorWindowMigrated(
  view: EditorView,
  listener: (win: Window) => void,
): () => void {
  return view.scrollDOM.onWindowMigrated(listener);
}
