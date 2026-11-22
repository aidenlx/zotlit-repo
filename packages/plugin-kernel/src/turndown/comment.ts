import type TurndownService from "turndown";

export function createCommentTurndown(
  Turndown: typeof TurndownService,
): TurndownService {
  const td = new Turndown();
  td.addRule("subscript", {
    filter: "sub",
    replacement: (content) => `<sub>${content}</sub>`,
  });
  td.addRule("superscript", {
    filter: "sup",
    replacement: (content) => `<sup>${content}</sup>`,
  });
  td.escape = (text) => text;
  return td;
}

export function commentToMarkdown(td: TurndownService, html: string): string {
  return td.turndown(html.replaceAll("\n", "<br>")).trim();
}
