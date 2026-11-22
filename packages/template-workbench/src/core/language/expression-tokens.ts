import { tags } from "@lezer/highlight";

import { templateHighlighter } from "./highlight.ts";

export const expressionTag = {
  name: tags.propertyName,
  callee: tags.function(tags.propertyName),
  literal: tags.literal,
  number: tags.number,
  string: tags.string,
  regexp: tags.regexp,
  operator: tags.operator,
  bracket: tags.paren,
  punctuation: tags.punctuation,
} as const;

export type ExpressionRole = keyof typeof expressionTag;

export function expressionClasses(role: ExpressionRole): string {
  return templateHighlighter.style([expressionTag[role]]) ?? "";
}
