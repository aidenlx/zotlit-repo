import { regex } from "arkregex";

const ANNOTATION_COLOR_NAMES = {
  "#FFD400": "yellow",
  "#FF6666": "red",
  "#5FB236": "green",
  "#2EA8E5": "blue",
  "#A28AE5": "purple",
  "#E56EEE": "magenta",
  "#F19837": "orange",
  "#AAAAAA": "gray",
  "#FF8C19": "orange",
  "#A6507B": "plum",
} as const;

export type AnnotationColorName =
  (typeof ANNOTATION_COLOR_NAMES)[keyof typeof ANNOTATION_COLOR_NAMES];

export function annotationColorToName(
  raw: string | null | undefined,
): AnnotationColorName | null {
  if (!raw) return null;
  return (
    ANNOTATION_COLOR_NAMES[
      raw.toUpperCase() as keyof typeof ANNOTATION_COLOR_NAMES
    ] ?? null
  );
}

const NOTE_HIGHLIGHT_COLOR_NAMES = {
  "#FFD400": "yellow",
  "#FF6666": "red",
  "#5FB236": "green",
  "#2EA8E5": "blue",
  "#A28AE5": "purple",
  "#F19837": "orange",
  "#E56EEE": "magenta",
  "#AAAAAA": "gray",
} as const;

const NOTE_TEXT_COLOR_NAMES = {
  "#FF2020": "red",
  "#FF7700": "orange",
  "#FFCB00": "yellow",
  "#4EB31C": "green",
  "#7953E3": "purple",
  "#EB52F7": "magenta",
  "#05A2EF": "blue",
  "#7E8386": "gray",
} as const;

export type NoteHighlightColorName =
  (typeof NOTE_HIGHLIGHT_COLOR_NAMES)[keyof typeof NOTE_HIGHLIGHT_COLOR_NAMES];
export type NoteTextColorName =
  (typeof NOTE_TEXT_COLOR_NAMES)[keyof typeof NOTE_TEXT_COLOR_NAMES];

const RGB_FUNCTIONAL = regex(
  "^rgba?\\(\\s*(?<r>\\d+)[\\s,]+(?<g>\\d+)[\\s,]+(?<b>\\d+)",
  "i",
);

function toCanonicalHex6(raw: string): string | null {
  if (raw.startsWith("#")) return raw.slice(0, 7).toUpperCase();
  const match = RGB_FUNCTIONAL.exec(raw);
  if (!match) return null;
  const { r, g, b } = match.groups;
  const hex = (n: string) =>
    Number(n).toString(16).padStart(2, "0").toUpperCase();
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function highlightColorToName(
  raw: string | null | undefined,
): NoteHighlightColorName | null {
  if (!raw) return null;
  const key = toCanonicalHex6(raw);
  if (!key) return null;
  return (
    NOTE_HIGHLIGHT_COLOR_NAMES[
      key as keyof typeof NOTE_HIGHLIGHT_COLOR_NAMES
    ] ?? null
  );
}

export function textColorToName(
  raw: string | null | undefined,
): NoteTextColorName | null {
  if (!raw) return null;
  const key = toCanonicalHex6(raw);
  if (!key) return null;
  return (
    NOTE_TEXT_COLOR_NAMES[key as keyof typeof NOTE_TEXT_COLOR_NAMES] ?? null
  );
}

export function annotationColorsForName(name: string): readonly string[] {
  return Object.entries(ANNOTATION_COLOR_NAMES)
    .filter(([, value]) => value === name)
    .map(([hex]) => hex);
}
