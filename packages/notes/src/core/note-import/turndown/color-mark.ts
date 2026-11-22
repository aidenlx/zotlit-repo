import { highlightEmoji } from "@zotlit/plugin-kernel/highlight-mapping.ts";
import type { HighlightMappings } from "@zotlit/plugin-kernel/highlight-mapping.ts";

export interface HighlightOptions {
  useColoredHighlightSyntax: boolean;
  highlightMappings?: HighlightMappings;
}

export type ColorMarkKind = "highlight" | "underline" | "text";

interface ColorMarkSpec {
  tag: string;
  className: string;
  cssProp: string;
  cssVar: string;
}

interface ColorMarkColor {
  raw: string;
  name: string | null;
}

const COLOR_MARK_SPEC: Record<ColorMarkKind, ColorMarkSpec> = {
  highlight: {
    tag: "mark",
    className: "zotlit-hl",
    cssProp: "background-color",
    cssVar: "--zotlit-hl",
  },
  underline: {
    tag: "u",
    className: "zotlit-ul",
    cssProp: "text-decoration-color",
    cssVar: "--zotlit-ul",
  },
  text: {
    tag: "span",
    className: "zotlit-color",
    cssProp: "color",
    cssVar: "--zotlit-color",
  },
};

export function renderHighlight(
  text: string,
  color: ColorMarkColor | null,
  options: Partial<HighlightOptions>,
): string {
  const emoji = options.useColoredHighlightSyntax
    ? highlightEmoji(color?.name, options.highlightMappings)
    : null;
  if (emoji && !text.includes("==")) {
    return `==${emoji}${text}==`;
  }
  return renderColorMark("highlight", text, color);
}

export function renderColorMark(
  kind: ColorMarkKind,
  text: string,
  color: ColorMarkColor | null,
): string {
  const { tag, className, cssProp, cssVar } = COLOR_MARK_SPEC[kind];
  let attrs = ` class="${className}"`;
  if (color) {
    attrs += color.name
      ? ` data-color="${color.name}" style="${cssProp}: var(${cssVar}-${color.name}, ${color.raw});"`
      : ` style="${cssProp}: ${color.raw};"`;
  }
  return `<${tag}${attrs}>${text}</${tag}>`;
}
