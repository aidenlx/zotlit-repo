import { annotationColorToName } from "@zotlit/db";
import type { AnnotationColorName } from "@zotlit/db";
import * as m from "@zotlit/plugin-messages/messages.ts";

export const ANNOTATION_COLORS: readonly string[] = [
  "#ffd400",
  "#ff6666",
  "#5fb236",
  "#2ea8e5",
  "#a28ae5",
  "#e56eee",
  "#f19837",
  "#aaaaaa",
];

const COLOR_MESSAGE: Record<AnnotationColorName, () => string> = {
  yellow: m.annot_view_color_yellow,
  red: m.annot_view_color_red,
  green: m.annot_view_color_green,
  blue: m.annot_view_color_blue,
  purple: m.annot_view_color_purple,
  magenta: m.annot_view_color_magenta,
  orange: m.annot_view_color_orange,
  gray: m.annot_view_color_gray,
  plum: m.annot_view_color_plum,
};

export function annotationColorLabel(hex: string): string {
  const name = annotationColorToName(hex);
  return name ? COLOR_MESSAGE[name]() : hex;
}

export function isColor(stored: string | null, swatch: string): boolean {
  return stored !== null && stored.toLowerCase() === swatch.toLowerCase();
}

export function offeredSwatches(
  recent: readonly string[],
  count: number,
): readonly string[] {
  const used = recent.flatMap((color) =>
    ANNOTATION_COLORS.filter((hex) => isColor(color, hex)),
  );
  return [...new Set([...used, ...ANNOTATION_COLORS])].slice(0, count);
}

export function withRecentColor(
  recent: readonly string[],
  color: string,
): string[] {
  return [color, ...recent.filter((stored) => !isColor(stored, color))].slice(
    0,
    ANNOTATION_COLORS.length,
  );
}
