import type TurndownService from "turndown";

import { highlightColorToName, textColorToName } from "@zotlit/db";

import type { HighlightOptions } from "./color-mark.ts";
import { renderColorMark, renderHighlight } from "./color-mark.ts";
import { createObsidianTurndown } from "./obsidian-base.ts";

export const ANNOTATION_CALLOUT_ATTR = "data-zt-callout";

export function encodeCalloutAttr(markdown: string): string {
  return encodeURIComponent(markdown);
}

function decodeCalloutAttr(encoded: string): string {
  return decodeURIComponent(encoded);
}

function addZoteroRules(
  td: TurndownService,
  options: NoteTurndownOptions,
): void {
  td.addRule("mathInline", {
    filter: (node) =>
      node.nodeName === "SPAN" && node.classList.contains("math"),
    replacement: (_content, node) => node.textContent ?? "",
  });

  td.addRule("mathBlock", {
    filter: (node) =>
      node.nodeName === "PRE" && node.classList.contains("math"),
    replacement: (_content, node) => `\n\n${node.textContent ?? ""}\n\n`,
  });

  td.addRule("codeBlock", {
    filter: (node) =>
      node.nodeName === "PRE" &&
      !node.classList.contains("math") &&
      node.firstChild?.nodeName !== "CODE",
    replacement: (_content, node, options) => {
      const fence = options.fence ?? "```";
      return `\n\n${fence}\n${node.textContent ?? ""}\n${fence}\n\n`;
    },
  });

  td.addRule("strikethroughSpan", {
    filter: (node) => {
      if (node.nodeName !== "SPAN") return false;
      const { textDecoration, textDecorationLine } = node.style;
      return (
        textDecoration.includes("line-through") ||
        textDecorationLine.includes("line-through")
      );
    },
    replacement: (content) => `~~${content}~~`,
  });

  td.addRule("subscript", {
    filter: "sub",
    replacement: (content) => `<sub>${content}</sub>`,
  });

  td.addRule("superscript", {
    filter: "sup",
    replacement: (content) => `<sup>${content}</sup>`,
  });

  td.addRule("underline", {
    filter: "u",
    replacement: (content) => `<u>${content}</u>`,
  });

  td.addRule("coloredSpan", {
    filter: (node) =>
      node.nodeName === "SPAN" &&
      !!(node.style.color || node.style.backgroundColor),
    replacement: (content, node) => {
      const { color, backgroundColor } = node.style;
      return backgroundColor
        ? renderHighlight(
            content,
            {
              raw: backgroundColor,
              name: highlightColorToName(backgroundColor),
            },
            options,
          )
        : renderColorMark("text", content, {
            raw: color,
            name: textColorToName(color),
          });
    },
  });

  td.addRule("embeddedImage", {
    filter: (node) =>
      node.nodeName === "IMG" && node.hasAttribute("data-attachment-key"),
    replacement:
      options.embeddedImage ??
      ((_content, node) => (node as Element).outerHTML),
  });

  td.addRule("citation", {
    filter: (node) =>
      node.nodeName === "SPAN" &&
      node.classList.contains("citation") &&
      node.hasAttribute("data-citation"),
    replacement:
      options.citation ?? ((_content, node) => (node as Element).outerHTML),
  });

  td.addRule("annotationExcerpt", {
    filter: (node) =>
      node.nodeName === "SPAN" && node.hasAttribute("data-annotation"),
    replacement:
      options.annotationExcerpt ??
      ((_content, node) => (node as Element).outerHTML),
  });

  td.addRule("annotationCallout", {
    filter: (node) =>
      node.nodeName === "DIV" && node.hasAttribute(ANNOTATION_CALLOUT_ATTR),
    replacement: (_content, node) =>
      `\n\n${decodeCalloutAttr(
        (node as Element).getAttribute(ANNOTATION_CALLOUT_ATTR) ?? "",
      )}\n\n`,
  });
}

interface NoteTurndownOptions extends Partial<HighlightOptions> {
  annotationExcerpt?: TurndownService.ReplacementFunction;
  embeddedImage?: TurndownService.ReplacementFunction;
  citation?: TurndownService.ReplacementFunction;
}

export function createNoteTurndown(
  Turndown: typeof TurndownService,
  options: NoteTurndownOptions = {},
): TurndownService {
  const td = createObsidianTurndown(Turndown);
  addZoteroRules(td, options);
  return td;
}

export { createObsidianTurndown } from "./obsidian-base.ts";
