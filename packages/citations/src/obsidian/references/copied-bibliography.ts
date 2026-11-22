import type { Inlines } from "#core/pandoc/ast.ts";

import {
  DISPLAY_CLASSES,
  flowWriter,
  inlineText,
  linkHref,
  QUOTE_MARKS,
  WRAPPER_TAGS,
} from "#obsidian/pandoc/inline-content.tsx";

export interface CopiedBibliographyEntry {
  readonly marker: Inlines | undefined;
  readonly content: Inlines;
}

export interface CopiedBibliography {
  html: string;
  text: string;
}

export function toCopiedBibliography(
  entries: readonly CopiedBibliographyEntry[],
): CopiedBibliography {
  return {
    html: entries.map(richEntry).join("\n"),
    text: entries.map(plainEntry).join("\n\n"),
  };
}

function richEntry({ marker, content }: CopiedBibliographyEntry): string {
  const paragraph = createEl("p");
  const label = marker === undefined ? "" : collapse(inlineText(marker));
  if (label) paragraph.append(`${label} `);
  paragraph.append(portable(content));
  return paragraph.outerHTML;
}

function portable(nodes: Inlines): DocumentFragment {
  const fragment = createFragment();
  const { separate, add, endPart } = flowWriter<Node>((node) => {
    fragment.append(node);
  });

  function wrap(
    tag: keyof HTMLElementTagNameMap,
    content: Inlines,
  ): HTMLElement {
    const element = createEl(tag);
    element.append(portable(content));
    return element;
  }

  function walk(inlines: Inlines): void {
    for (const inline of inlines) {
      switch (inline.t) {
        case "Str":
          add(inline.c);
          break;
        case "Space":
        case "SoftBreak":
          separate();
          break;
        case "Emph":
        case "Strong":
        case "Underline":
        case "Strikeout":
        case "Superscript":
        case "Subscript":
          add(wrap(WRAPPER_TAGS[inline.t], inline.c));
          break;
        case "SmallCaps": {
          const element = wrap("span", inline.c);
          element.style.setProperty("font-variant", "small-caps");
          add(element);
          break;
        }
        case "Quoted": {
          const [open, close] = QUOTE_MARKS[inline.c[0].t];
          add(open);
          walk(inline.c[1]);
          add(close);
          break;
        }
        case "Code": {
          const [, source] = inline.c;
          add(source);
          break;
        }
        case "Math": {
          const [, source] = inline.c;
          add(source);
          break;
        }
        case "Cite": {
          const [, content] = inline.c;
          walk(content);
          break;
        }
        case "Image": {
          const [, alt] = inline.c;
          walk(alt);
          break;
        }
        case "Span": {
          const [[, classes], content] = inline.c;
          const display = classes.some((name) => DISPLAY_CLASSES.has(name));
          if (display) separate();
          walk(content);
          if (display) endPart();
          break;
        }
        case "Link": {
          const [, children, [url]] = inline.c;
          const href = linkHref(url);
          if (href === null) {
            walk(children);
            break;
          }
          const anchor = wrap("a", children);
          anchor.setAttribute("href", href);
          add(anchor);
          break;
        }
        case "LineBreak":
        case "Note":
        case "RawInline":
          break;
      }
    }
  }

  walk(nodes);
  return fragment;
}

function plainEntry({ marker, content }: CopiedBibliographyEntry): string {
  const body = collapse(inlineText(content));
  const label = marker === undefined ? "" : collapse(inlineText(marker));
  return [label, body].filter(Boolean).join(" ");
}

function collapse(text: string): string {
  return text.replaceAll(/[\t\n\r ]+/g, " ").trim();
}
