// Eta v4 tag delimiters with plain tag bodies.
import { LanguageSupport, LRLanguage } from "@codemirror/language";
import { parseMixed } from "@lezer/common";

import { etaAutoPair } from "./eta-auto-pair.ts";
import { etaParser } from "./eta-syntax.ts";
import { markdownParser } from "./markdown.ts";
export { etaRange } from "./eta-syntax.ts";

export const etaLanguage = LRLanguage.define({
  name: "eta",
  parser: etaParser,
});

export const eta = new LanguageSupport(etaLanguage, [etaAutoPair()]);

export const etaBody = etaLanguage.configure({
  wrap: parseMixed((node) =>
    node.type.isTop
      ? {
          parser: markdownParser,
          overlay: (child) => child.name === "Text",
        }
      : null,
  ),
});
