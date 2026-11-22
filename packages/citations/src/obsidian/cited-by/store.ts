import type { ParsedNote } from "#obsidian/citation-index/parsed-note.ts";
import type {
  CitationOccurrence,
  CitedByGroup,
  CitedBySnapshot,
} from "#obsidian/citation-index/service.ts";
import type {
  CachedMetadata,
  ListItemCache,
  Pos,
  SectionCache,
} from "obsidian";

export interface SourceRange {
  start: number;
  end: number;
}

export interface ReadyOccurrenceContext {
  status: "ready";
  range: SourceRange;
  rangeClippedStart: boolean;
  rangeClippedEnd: boolean;
  block: SourceRange;
  token: SourceRange;
}

export type OccurrenceContext =
  | { status: "unavailable" }
  | ReadyOccurrenceContext;

export interface SourceOutline {
  listItems: readonly ListItemCache[];
  sections: readonly SectionCache[];
}

export type CitedByPreview =
  | { readonly status: "loading" }
  | { readonly status: "unavailable" }
  | ReadyPreview;

export interface ReadyPreview {
  readonly status: "ready";
  readonly facts: ParsedNote;
  readonly source: string;
  readonly outline: SourceOutline;
  readonly cache: CachedMetadata | null;
}

export function previewContexts(
  preview: ReadyPreview,
  occurrences: readonly CitationOccurrence[],
): Readonly<Record<string, OccurrenceContext>> {
  return Object.fromEntries(
    occurrences.map((occurrence) => [
      occurrenceID(occurrence),
      citationContext(
        preview.source,
        preview.facts.currentOccurrence(occurrence),
        preview.cache,
      ),
    ]),
  );
}

export const CITED_BY_SORT_GROUPS = [
  ["alphabetical", "alphabeticalReverse"],
  ["byModifiedTime", "byModifiedTimeReverse"],
  ["byCreatedTime", "byCreatedTimeReverse"],
] as const;

export type CitedBySortMode = (typeof CITED_BY_SORT_GROUPS)[number][number];

export const DEFAULT_CITED_BY_SORT: CitedBySortMode = "alphabetical";

export const EMPTY_CITED_BY_SNAPSHOT: CitedBySnapshot = {
  groups: [],
  coverage: "indexing",
  resolution: null,
};

export interface SourceFileFacts {
  name: string;
  mtime: number;
  ctime: number;
}

const nameOrder = new Intl.Collator(undefined, {
  usage: "sort",
  sensitivity: "base",
  numeric: true,
});

const SORT_COMPARATORS: Record<
  CitedBySortMode,
  (a: SourceFileFacts, b: SourceFileFacts) => number
> = {
  alphabetical: (a, b) => nameOrder.compare(a.name, b.name),
  alphabeticalReverse: (a, b) => nameOrder.compare(b.name, a.name),
  byModifiedTime: (a, b) => b.mtime - a.mtime,
  byModifiedTimeReverse: (a, b) => a.mtime - b.mtime,
  byCreatedTime: (a, b) => b.ctime - a.ctime,
  byCreatedTimeReverse: (a, b) => a.ctime - b.ctime,
};

export function sortCitedByGroups(
  groups: readonly CitedByGroup[],
  mode: CitedBySortMode,
  facts: (path: string) => SourceFileFacts | null,
): readonly CitedByGroup[] {
  const compare = SORT_COMPARATORS[mode];
  return groups
    .map((group) => ({
      group,
      facts: facts(group.path) ?? {
        name: noteName(group.path),
        mtime: 0,
        ctime: 0,
      },
    }))
    .sort((a, b) => compare(a.facts, b.facts))
    .map(({ group }) => group);
}

export function noteName(path: string): string {
  const slash = path.lastIndexOf("/");
  const filename = path.slice(slash + 1);
  return filename.endsWith(".md") ? filename.slice(0, -3) : filename;
}

export const COMPACT_CAP = 100;

export function citationContext(
  source: string,
  occurrence: CitationOccurrence | null,
  cache: CachedMetadata | null,
): OccurrenceContext {
  if (!occurrence) return { status: "unavailable" };
  const { start, end } = occurrence.position;
  const token = { start: start.offset, end: end.offset };
  const lineRange = enclosingLine(source, token);
  const compact = compactExcerpt(source, token);
  return {
    status: "ready",
    range: compact.range,
    rangeClippedStart: compact.clippedStart,
    rangeClippedEnd: compact.clippedEnd,
    block: enclosingBlock(cache, token) ?? lineRange,
    token,
  };
}

function enclosingLine(source: string, token: SourceRange): SourceRange {
  const lineStart = source.lastIndexOf("\n", Math.max(0, token.start - 1)) + 1;
  const nextBreak = source.indexOf("\n", token.end);
  return {
    start: lineStart,
    end: nextBreak === -1 ? source.length : nextBreak,
  };
}

function compactExcerpt(
  source: string,
  token: SourceRange,
): { range: SourceRange; clippedStart: boolean; clippedEnd: boolean } {
  let start = token.start - 1;
  let back = 0;
  while (back < COMPACT_CAP && start >= 0) {
    if (source.charCodeAt(start) === 10) break;
    start -= 1;
    back += 1;
  }
  start += 1;

  let end = token.end;
  let fwd = 0;
  while (fwd < COMPACT_CAP && end < source.length) {
    if (source.charCodeAt(end) === 10) break;
    end += 1;
    fwd += 1;
  }
  return {
    range: { start, end },
    clippedStart: back === COMPACT_CAP,
    clippedEnd: fwd === COMPACT_CAP,
  };
}

function enclosingBlock(
  cache: CachedMetadata | null,
  token: SourceRange,
): SourceRange | null {
  const items = cache?.listItems ?? [];
  const index = items.findIndex(({ position }) => encloses(position, token));
  const item = items[index];
  if (item) {
    return {
      start: lineStartOf(item.position),
      end: listItemEnd(items, index),
    };
  }
  const section = cache?.sections?.find(
    ({ position, type }) => type !== "list" && encloses(position, token),
  );
  if (!section) return null;
  return {
    start: section.position.start.offset,
    end: section.position.end.offset,
  };
}

function encloses(position: Pos, token: SourceRange): boolean {
  return (
    position.start.offset <= token.start && token.end <= position.end.offset
  );
}

function listItemEnd(items: readonly ListItemCache[], index: number): number {
  const item = items[index];
  if (!item) return 0;
  const lines = new Set([item.position.start.line]);
  let last = item;
  for (const candidate of items.slice(index + 1)) {
    if (!lines.has(candidate.parent)) break;
    lines.add(candidate.position.start.line);
    last = candidate;
  }
  return last.position.end.offset;
}

function lineStartOf(position: Pos): number {
  return position.start.offset - position.start.col;
}

export interface ContextParts {
  before: string;
  token: string;
  after: string;
  ellipsisBefore: boolean;
  ellipsisAfter: boolean;
  canExpandBefore: boolean;
  canExpandAfter: boolean;
}

export interface ExcerptOptions {
  moreContext?: boolean;
  expansion?: SourceRange | undefined;
}

export function excerptRange(
  context: ReadyOccurrenceContext,
  options: ExcerptOptions = {},
): SourceRange {
  const mode = options.moreContext ? context.block : context.range;
  const { expansion } = options;
  if (!expansion) return mode;
  return {
    start: Math.min(mode.start, expansion.start),
    end: Math.max(mode.end, expansion.end),
  };
}

export function contextParts(
  source: string,
  context: ReadyOccurrenceContext,
  options: ExcerptOptions = {},
): ContextParts {
  const { token } = context;
  const range = excerptRange(context, options);
  const showEllipsis = !options.moreContext && !options.expansion;
  return {
    before: source.slice(range.start, token.start),
    token: source.slice(token.start, token.end),
    after: source.slice(token.end, range.end),
    ellipsisBefore: showEllipsis && context.rangeClippedStart,
    ellipsisAfter: showEllipsis && context.rangeClippedEnd,
    canExpandBefore: hasText(source, 0, range.start),
    canExpandAfter: hasText(source, range.end, source.length),
  };
}

const WHITESPACE = /\s/u;

function hasText(source: string, from: number, to: number): boolean {
  for (let at = from; at < to; at += 1) {
    if (!WHITESPACE.test(source.charAt(at))) return true;
  }
  return false;
}

export type ExpandDirection = "before" | "after";

export function sourceOutline(cache: CachedMetadata | null): SourceOutline {
  return { listItems: cache?.listItems ?? [], sections: cache?.sections ?? [] };
}

export function expandExcerptRange(options: {
  source: string;
  outline: SourceOutline;
  range: SourceRange;
  direction: ExpandDirection;
}): SourceRange {
  const { source, outline, range, direction } = options;
  if (direction === "before") {
    let at = range.start;
    while (at > 0) {
      at -= 1;
      const chunkStart = chunkStartAt(source, outline, at);
      if (chunkStart < at) {
        at = chunkStart;
        break;
      }
    }
    return { start: at, end: range.end };
  }
  let at = range.end;
  while (at < source.length) {
    at += 1;
    const chunkEnd = chunkEndAt(source, outline, at);
    if (chunkEnd > at) {
      at = chunkEnd;
      break;
    }
  }
  return { start: range.start, end: at };
}

function chunkStartAt(
  source: string,
  outline: SourceOutline,
  at: number,
): number {
  const item = outline.listItems[coveringIndex(outline.listItems, at)];
  if (item) return lineStartOf(item.position);
  const section = outline.sections[coveringIndex(outline.sections, at)];
  if (section && section.type !== "list") return lineStartOf(section.position);
  return source.lastIndexOf("\n", at - 1) + 1;
}

function chunkEndAt(
  source: string,
  outline: SourceOutline,
  at: number,
): number {
  const index = coveringIndex(outline.listItems, at);
  if (index !== -1) return listItemEnd(outline.listItems, index);
  const section = outline.sections[coveringIndex(outline.sections, at)];
  if (section && section.type !== "list") return section.position.end.offset;
  const lineBreak = source.indexOf("\n", at);
  return lineBreak === -1 ? source.length : lineBreak;
}

function coveringIndex(
  entries: readonly { position: Pos }[],
  at: number,
): number {
  return entries.findLastIndex(
    ({ position }) => lineStartOf(position) <= at && at <= position.end.offset,
  );
}

export function excerptKey(
  path: string,
  occurrence: CitationOccurrence,
): string {
  return `${path}\n${occurrenceID(occurrence)}`;
}

export function excerptKeyIn(key: string, path: string): boolean {
  return key.startsWith(`${path}\n`);
}

export function occurrenceID(options: {
  kind: string;
  raw: string;
  position: { start: { offset: number }; end: { offset: number } };
}): string {
  const { kind, raw, position } = options;
  return `${kind}:${position.start.offset}:${position.end.offset}:${raw}`;
}
