import { liquidTagLanguage } from "@codemirror/lang-liquid";
import { LanguageSupport, syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";
import { Decoration, ViewPlugin } from "@codemirror/view";
import type { Tree } from "@lezer/common";
import { parseMixed } from "@lezer/common";
import { regex } from "arkregex";

import { templateToken } from "./highlight.ts";
import { liquidRanges } from "./liquid-ranges.ts";
import { markdownParser } from "./markdown.ts";
export { liquidRanges } from "./liquid-ranges.ts";
export type { LiquidRange } from "./liquid-ranges.ts";

const delimiter = Decoration.mark({ class: templateToken.delimiter });
const keyword = Decoration.mark({ class: templateToken.keyword });
const TAG_NAME = regex("^\\s*(?<name>[\\w#]+)");

export function refusedLiquidMarks(
  source: string,
  tree: Tree,
): Range<Decoration>[] {
  const marks: Range<Decoration>[] = [];
  for (const range of liquidRanges(source)) {
    let owner = tree.resolve(range.from, 1);
    while (owner.parent && !owner.type.isTop) owner = owner.parent;
    if (owner.name !== "Template") continue;
    const parsedOpen = tree.resolveInner(range.from, 1).name;
    const parsedClose = tree.resolveInner(range.to, -1).name;
    const parserReadOpen = parsedOpen.startsWith("{");
    const parserReadClose = parsedClose.endsWith("}");
    if (range.line || (parserReadOpen && (parserReadClose || !range.closed)))
      continue;
    const open = range.from + (source[range.from + 2] === "-" ? 3 : 2);
    const close = range.closed
      ? range.to - (source[range.to - 3] === "-" ? 3 : 2)
      : range.to;
    if (!parserReadOpen) marks.push(delimiter.range(range.from, open));
    const name = TAG_NAME.exec(source.slice(open, close));
    if (name)
      marks.push(
        keyword.range(
          open + name[0].length - name.groups.name.length,
          open + name[0].length,
        ),
      );
    if (range.closed && !parserReadClose)
      marks.push(delimiter.range(close, range.to));
  }
  return marks;
}

const refusedTagHighlight = ViewPlugin.define(
  (view) => ({
    decorations: Decoration.set(
      refusedLiquidMarks(view.state.doc.toString(), syntaxTree(view.state)),
      true,
    ),
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      )
        this.decorations = Decoration.set(
          refusedLiquidMarks(
            update.state.doc.toString(),
            syntaxTree(update.state),
          ),
          true,
        );
    },
  }),
  { decorations: (plugin) => plugin.decorations },
);

export const liquidTemplate = new LanguageSupport(liquidTagLanguage, [
  refusedTagHighlight,
]);

export const liquidBody = new LanguageSupport(
  liquidTagLanguage.configure({
    wrap: parseMixed((node) =>
      node.type.isTop
        ? {
            parser: markdownParser,
            overlay: (child) =>
              child.name === "Text" || child.name === "RawText",
          }
        : null,
    ),
  }),
  [refusedTagHighlight],
);
