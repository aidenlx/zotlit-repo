import type { AnnotationRecord } from "#obsidian/annotation-repository/service.ts";

import { ANNOTATION_COLORS } from "@zotlit/plugin-kernel/annotation-colors.ts";

export interface AnnotFilter {
  query: string;
  colors: readonly string[];
  tags: readonly string[];
}

const SWATCH_PALETTE_ORDER = ANNOTATION_COLORS.map((color) =>
  color.toUpperCase(),
);

const HTML_TAG = /<[^>]*>/g;

function stripHtml(html: string): string {
  return html.replaceAll(HTML_TAG, " ");
}

function matchesQuery(annot: AnnotationRecord, query: string): boolean {
  const needle = query.toLowerCase();
  if (annot.text?.toLowerCase().includes(needle)) return true;
  if (annot.comment && stripHtml(annot.comment).toLowerCase().includes(needle))
    return true;
  if (annot.tags.some((tag) => tag.toLowerCase().includes(needle))) return true;
  if (annot.pageLabel?.toLowerCase().includes(needle)) return true;
  return false;
}

function matchesColors(
  annot: AnnotationRecord,
  colors: readonly string[],
): boolean {
  if (colors.length === 0) return true;
  return annot.color !== null && colors.includes(annot.color.toUpperCase());
}

function matchesTags(
  annot: AnnotationRecord,
  tags: readonly string[],
): boolean {
  return annot.tags.some((tag) => tags.includes(tag));
}

export function isFilterActive(filter: AnnotFilter): boolean {
  return (
    filter.query !== "" || filter.colors.length > 0 || filter.tags.length > 0
  );
}

export function filterAnnotations(
  annots: readonly AnnotationRecord[],
  filter: AnnotFilter,
): AnnotationRecord[] {
  return annots.filter(
    (annot) =>
      (filter.query === "" || matchesQuery(annot, filter.query)) &&
      matchesColors(annot, filter.colors) &&
      (filter.tags.length === 0 || matchesTags(annot, filter.tags)),
  );
}

function collectColors(annots: readonly AnnotationRecord[]): Set<string> {
  const seen = new Set<string>();
  for (const annot of annots) {
    if (annot.color) seen.add(annot.color.toUpperCase());
  }
  return seen;
}

export function deriveSwatchColors(
  annots: readonly AnnotationRecord[],
): string[] {
  const seen = collectColors(annots);
  const known = SWATCH_PALETTE_ORDER.filter((color) => seen.has(color));
  const unknown = [...seen].filter(
    (color) => !SWATCH_PALETTE_ORDER.includes(color),
  );
  return [...known, ...unknown];
}

export interface SavedFilter {
  colors: string[];
  tags: string[];
}

export function sanitizeSavedFilter(
  raw: unknown,
  annots: readonly AnnotationRecord[],
): SavedFilter | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null) return null;
  const { colors, tags } = parsed as Record<string, unknown>;
  if (!Array.isArray(colors) || !Array.isArray(tags)) return null;
  if (!colors.every((c) => typeof c === "string")) return null;
  if (!tags.every((t) => typeof t === "string")) return null;

  const availableColors = collectColors(annots);
  const availableTags = new Set(annots.flatMap((a) => a.tags));

  const survivingColors = [
    ...new Set(colors.map((c) => c.toUpperCase())),
  ].filter((c) => availableColors.has(c));
  const survivingTags = [...new Set(tags)].filter((tag) =>
    availableTags.has(tag),
  );

  if (survivingColors.length === 0 && survivingTags.length === 0) return null;
  return { colors: survivingColors, tags: survivingTags };
}

export interface TagChip {
  name: string;
  selected: boolean;
  hitCount: number;
  available: boolean;
}

export function deriveTagChips(
  annots: readonly AnnotationRecord[],
  filter: AnnotFilter,
): TagChip[] {
  const availableFilter: AnnotFilter = { ...filter, tags: [] };
  const seen = new Set<string>();
  const hitCounts = new Map<string, number>();
  for (const annot of annots) {
    const passesColorAndQuery =
      matchesColors(annot, availableFilter.colors) &&
      (availableFilter.query === "" ||
        matchesQuery(annot, availableFilter.query));
    for (const tag of annot.tags) {
      seen.add(tag);
      if (passesColorAndQuery) {
        hitCounts.set(tag, (hitCounts.get(tag) ?? 0) + 1);
      }
    }
  }

  const chips = [...seen].map((name) => {
    const hitCount = hitCounts.get(name) ?? 0;
    return {
      name,
      selected: filter.tags.includes(name),
      hitCount,
      available: hitCount > 0,
    };
  });

  return chips.sort(
    (a, b) => b.hitCount - a.hitCount || a.name.localeCompare(b.name),
  );
}

export interface CappedSelection<T> {
  shown: T[];
  hiddenCount: number;
}

export function cappedSelection<T>(
  values: readonly T[],
  cap: number,
): CappedSelection<T> {
  return {
    shown: values.slice(0, cap),
    hiddenCount: Math.max(0, values.length - cap),
  };
}
