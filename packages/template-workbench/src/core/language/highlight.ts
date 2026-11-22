import { syntaxHighlighting } from "@codemirror/language";
import type { NodeType } from "@lezer/common";
import { tagHighlighter, tags } from "@lezer/highlight";

import { markdownTop } from "./markdown.ts";

export const templateToken = {
  delimiter: "zt-template-delimiter",
  keyword: "zt-template-keyword",
  variable: "zt-template-variable",
  property: "zt-template-property",
  filter: "zt-template-filter",
  string: "zt-template-string",
  value: "zt-template-value",
  regexp: "zt-template-regexp",
  operator: "zt-template-operator",
  punctuation: "zt-template-punctuation",
  comment: "zt-template-comment",
  invalid: "zt-template-invalid",
} as const;

export type TemplateToken = keyof typeof templateToken;

export const templateHighlighter = tagHighlighter([
  { tag: tags.brace, class: templateToken.delimiter },
  { tag: [tags.keyword, tags.tagName], class: templateToken.keyword },
  { tag: tags.name, class: templateToken.variable },
  { tag: tags.propertyName, class: templateToken.property },
  { tag: tags.function(tags.variableName), class: templateToken.filter },
  { tag: tags.function(tags.propertyName), class: templateToken.filter },
  { tag: tags.string, class: templateToken.string },
  { tag: tags.literal, class: templateToken.value },
  {
    tag: tags.regexp,
    class: `${templateToken.value} ${templateToken.regexp}`,
  },
  { tag: tags.operator, class: templateToken.operator },
  { tag: tags.punctuation, class: templateToken.punctuation },
  { tag: [tags.comment, tags.meta], class: templateToken.comment },
  { tag: tags.invalid, class: templateToken.invalid },
]);

export const documentToken = {
  frontmatter: "zt-template-frontmatter",
  markdownMarker: "zt-template-markdown-marker",
  markdownListMarker: "zt-template-markdown-list-marker",
} as const;

export const templateHighlighters = [
  { ...templateHighlighter, scope: (node: NodeType) => node !== markdownTop },
  {
    ...tagHighlighter([
      {
        tag: tags.special(tags.punctuation),
        class: documentToken.markdownMarker,
      },
      {
        tag: tags.special(tags.separator),
        class: `${documentToken.markdownMarker} ${documentToken.markdownListMarker}`,
      },
    ]),
    scope: (node: NodeType) => node === markdownTop,
  },
];
export const templateHighlighting = templateHighlighters.map((highlighter) =>
  syntaxHighlighting(highlighter),
);
