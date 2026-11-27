import { closeBrackets } from "@codemirror/autocomplete";
import { json, jsonLanguage } from "@codemirror/lang-json";
import type { Range } from "@codemirror/state";
import { Prec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Decoration } from "@codemirror/view";
import { highlightTree } from "@lezer/highlight";

import { decorationLayer, gapsAround } from "./decorations.ts";
import { templateHighlighter } from "./highlight.ts";
import { jsonSyntaxTokens } from "./json-e.ts";

export const jsonRule = [json(), closeBrackets()];

export function embeddedJsonE(
  read: (source: string) => readonly { from: number; to: number }[],
) {
  function decorations(view: EditorView) {
    const marks: Range<Decoration>[] = [];
    for (const region of read(view.state.doc.toString())) {
      const source = view.state.doc.sliceString(region.from, region.to);
      const tokens = jsonSyntaxTokens(source);
      if (!jsonLanguage.isActiveAt(view.state, region.from))
        highlightTree(
          jsonLanguage.parser.parse(source),
          templateHighlighter,
          (from, to, classes) => {
            gapsAround({ from, to }, tokens, (start, end) =>
              marks.push(
                Decoration.mark({ class: classes }).range(
                  region.from + start,
                  region.from + end,
                ),
              ),
            );
          },
        );
      for (const token of tokens)
        marks.push(
          Decoration.mark({ class: token.classes }).range(
            region.from + token.from,
            region.from + token.to,
          ),
        );
    }
    return Decoration.set(marks, true);
  }
  return decorationLayer(decorations, { precedence: Prec.highest });
}
