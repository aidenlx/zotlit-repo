import { regex } from "arkregex";
import { Effect, Stream } from "effect";
import MiniSearch from "minisearch";
import type { SearchResult } from "minisearch";

import { parseItemDate, parseItemLanguage } from "@zotlit/db";
import type { IndexedItem, LanguageNameLookup } from "@zotlit/db";

import { formatCreator } from "./format-creator.ts";
import { Segmenter } from "./segmenter.ts";
import { normalize, normalizeWithIndexMap } from "./tokenizer.ts";

export type SearchMatches = [number, number][];

export interface ItemHit {
  itemID: number;
  indexedKey: string;
  libraryID: number;
  matches: SearchMatches;
}

export interface SearchOptions {
  limit: number;
  uses?: Readonly<Record<string, number>>;
  cited?: readonly string[];
}

export interface EngineIndexOptions {
  libraries: readonly number[];
  languageLookup?: LanguageNameLookup | null;
}

export type SearchField =
  | "title"
  | "shortTitle"
  | "creators"
  | "publicationTitle"
  | "court"
  | "citationKey"
  | "key"
  | "year";

const SEARCH_FIELDS = [
  "title",
  "shortTitle",
  "creators",
  "publicationTitle",
  "court",
  "citationKey",
  "key",
  "year",
] as const satisfies readonly SearchField[];

const BOOSTS: Record<SearchField, number> = {
  title: 2.5,
  shortTitle: 2.5,
  creators: 2,
  citationKey: 2,
  publicationTitle: 1.5,
  court: 1,
  key: 1,
  year: 1,
};

function fuzziness(term: string): number {
  return term.length <= 3 ? 0 : term.length <= 5 ? 0.1 : 0.2;
}

type IndexedSearchDocument = { id: number } & Record<SearchField, string>;

interface IndexedRecord {
  itemID: number;
  indexedKey: string;
  libraryID: number;
  title: string;
  citationKey: string | null;
  order: number;
  lastActivity: number | null;
}

export interface EngineIndex {
  readonly size: number;
  /** @internal */
  readonly mini: MiniSearch<IndexedSearchDocument>;
  /** @internal Last Activity order for empty searches. */
  readonly recent: readonly IndexedRecord[];
  /** @internal */
  readonly byKey: ReadonlyMap<string, IndexedRecord>;
  /** @internal */
  readonly byId: ReadonlyMap<number, IndexedRecord>;
  /** @internal The word splitter the index was built with, reused for queries. */
  readonly words: (text: string) => string[];
}

export interface EngineIndexBuilder {
  add(slice: readonly IndexedItem[]): Effect.Effect<void>;
  readonly build: Effect.Effect<EngineIndex>;
}

export const makeEngineIndexBuilder = (
  options: EngineIndexOptions,
): Effect.Effect<EngineIndexBuilder, never, Segmenter> =>
  Effect.map(Effect.service(Segmenter), ({ words }) => {
    const core = createCore(words, options);
    return {
      add: (slice) =>
        Effect.andThen(
          Effect.sync(() => core.add(slice)),
          Effect.yieldNow,
        ),
      build: Effect.sync(() => core.build()),
    };
  });

export const buildEngineIndex = <E, R>(
  slices: Stream.Stream<readonly IndexedItem[], E, R>,
  options: EngineIndexOptions,
): Effect.Effect<EngineIndex, E, R | Segmenter> =>
  Effect.gen(function* () {
    const builder = yield* makeEngineIndexBuilder(options);
    yield* Stream.runForEach(slices, (slice) => builder.add(slice));
    return yield* builder.build;
  });

export const searchEngineIndex = (
  index: EngineIndex,
  query: string,
  { limit, uses, cited }: SearchOptions,
): Effect.Effect<readonly ItemHit[]> =>
  Effect.gen(function* () {
    if (limit <= 0) return [];
    const lookup = lookupQuery(index, query, index.words);
    if (lookup.kind !== "ranked")
      return finishLookup(index, lookup, { limit, uses, cited });
    yield* Effect.yieldNow;
    return finishLookup(index, lookup, { limit, uses, cited });
  });

interface EngineCore {
  add(slice: readonly IndexedItem[]): void;
  build(): EngineIndex;
}

function createCore(
  words: (text: string) => string[],
  { libraries, languageLookup = null }: EngineIndexOptions,
): EngineCore {
  const mini = new MiniSearch<IndexedSearchDocument>({
    idField: "id",
    fields: [...SEARCH_FIELDS],
    storeFields: [],
    tokenize: (text, field) =>
      field === "citationKey" ? [text, ...words(text)] : words(text),
    processTerm,
  });
  const libraryRank = new Map(libraries.map((id, rank) => [id, rank]));
  const pending: { item: IndexedItem; record: IndexedRecord }[] = [];
  return {
    add(slice) {
      mini.addAll(
        slice.map((item) => {
          pending.push({
            item,
            record: {
              itemID: item.itemID,
              indexedKey: item.indexedKey,
              libraryID: item.libraryID,
              title: item.title ?? "",
              citationKey: item.citationKey
                ? normalize(item.citationKey)
                : null,
              order: 0,
              lastActivity: item.lastActivity,
            },
          });
          return toSearchDocument(item, languageLookup);
        }),
      );
    },
    build() {
      const compare = orderComparator(libraryRank);
      pending.sort((a, b) => compare(a.item, b.item));
      const ordered = pending.map(({ record }, order) => {
        record.order = order;
        return record;
      });
      pending.length = 0;
      return {
        size: ordered.length,
        mini,
        recent: ordered.toSorted(compareRecent),
        byKey: new Map(ordered.map((record) => [record.indexedKey, record])),
        byId: new Map(ordered.map((record) => [record.itemID, record])),
        words,
      };
    },
  };
}

function orderComparator(
  libraryRank: ReadonlyMap<number, number>,
): (a: IndexedItem, b: IndexedItem) => number {
  const rankOf = (item: IndexedItem): number =>
    libraryRank.get(item.libraryID) ?? libraryRank.size;
  return (a, b) =>
    b.dateModified.epochMilliseconds - a.dateModified.epochMilliseconds ||
    rankOf(a) - rankOf(b) ||
    a.itemID - b.itemID;
}

const DOI_RE = regex("\\b10\\.\\d{4,9}/[^\\s\\]\\)]+", "iu");
const ISBN_RE = regex(
  "\\b(?:ISBN[-: ]*)?(?=(?:\\D*\\d){10}(?:(?:\\D*\\d){3})?\\D*\\b)\\d[\\d -]{8,16}[\\dXx]\\b",
  "iu",
);
const BRACKETS_RE = regex("[()\\[\\]{}]", "gu");
const STRIPPED_PUNCT_RE = regex("[,;.]", "gu");
const ET_AL_RE = regex("\\bet\\s+al\\b\\.?|&\\s*\\bal\\b\\.?", "giu");
const AND_RE = regex("\\band\\b", "giu");
const LEADING_AT_RE = regex("^\\s*@", "u");
const WHITESPACE_RE = regex("\\s+", "gu");
const ZOTERO_KEY_RE = regex("^[A-Z0-9]{8}$", "u");

export function cleanQuery(input: string): string {
  if (DOI_RE.test(input) || ISBN_RE.test(input)) return input;

  return input
    .replace(BRACKETS_RE, " ")
    .replace(LEADING_AT_RE, " ")
    .replace(ET_AL_RE, " ")
    .replace(AND_RE, " ")
    .replace(STRIPPED_PUNCT_RE, " ")
    .replace(WHITESPACE_RE, " ")
    .trim();
}

type Lookup =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "key"; records: IndexedRecord[] }
  | {
      kind: "ranked";
      whole: string;
      results: SearchResult[];
    };

function lookupQuery(
  index: EngineIndex,
  query: string,
  words: (text: string) => string[],
): Lookup {
  if (query.trim().length === 0) return { kind: "all" };
  const cleaned = cleanQuery(query);
  const keyQuery = cleaned.toUpperCase();
  if (ZOTERO_KEY_RE.test(keyQuery)) {
    const records = index.mini
      .search(keyQuery.toLowerCase(), {
        fields: ["key"],
        prefix: false,
        fuzzy: false,
        tokenize: (text) => [text],
        processTerm: (term) => term,
      })
      .flatMap((result) => recordOf(index, result));
    if (records.length > 0) return { kind: "key", records };
  }

  const tokens = queryTokens(cleaned, words);
  if (tokens.length === 0) return { kind: "none" };

  const whole = normalize(cleaned);
  const results = index.mini.search({
    combineWith: "OR",
    queries: [
      {
        queries: [cleaned],
        combineWith: "AND",
        prefix: true,
        fuzzy: fuzziness,
        boost: BOOSTS,
        tokenize: () => tokens,
        processTerm: (term) => term,
      },
      {
        queries: [whole],
        fields: ["citationKey"],
        prefix: true,
        fuzzy: false,
        tokenize: (text) => [text],
        processTerm: (term) => term,
      },
    ],
  });
  return { kind: "ranked", whole, results };
}

function finishLookup(
  index: EngineIndex,
  lookup: Lookup,
  { limit, uses, cited }: SearchOptions,
): ItemHit[] {
  switch (lookup.kind) {
    case "all":
      return recentRecords(index, { limit, uses, cited }).map((record) =>
        hitOf(record, []),
      );
    case "none":
      return [];
    case "key":
      return lookup.records
        .sort((a, b) => a.order - b.order)
        .slice(0, limit)
        .map((record) => hitOf(record, []));
    case "ranked":
      return rankResults(index, lookup, limit);
  }
}

function compareRecent(a: IndexedRecord, b: IndexedRecord): number {
  return (
    (b.lastActivity ?? -Infinity) - (a.lastActivity ?? -Infinity) ||
    (a.indexedKey < b.indexedKey ? -1 : a.indexedKey > b.indexedKey ? 1 : 0)
  );
}

function recentRecords(
  index: EngineIndex,
  { limit, uses, cited }: SearchOptions,
): readonly IndexedRecord[] {
  const candidates = new Map(
    index.recent.slice(0, limit).map((record) => [record.indexedKey, record]),
  );
  const citedKeys = new Set(cited);
  for (const key of citedKeys) {
    const record = index.byKey.get(key);
    if (record) candidates.set(key, record);
  }
  for (const [key, use] of Object.entries(uses ?? {})) {
    const record = index.byKey.get(key);
    if (
      record &&
      Number.isFinite(use) &&
      (record.lastActivity === null || use > record.lastActivity)
    ) {
      candidates.set(key, { ...record, lastActivity: use });
    }
  }
  return [...candidates.values()]
    .sort(
      (a, b) =>
        Number(citedKeys.has(b.indexedKey)) -
          Number(citedKeys.has(a.indexedKey)) || compareRecent(a, b),
    )
    .slice(0, limit);
}

interface RankedResult {
  record: IndexedRecord;
  score: number;
  terms: readonly string[];
  keyLength: number | null;
}

function rankResults(
  index: EngineIndex,
  { whole, results }: Extract<Lookup, { kind: "ranked" }>,
  limit: number,
): ItemHit[] {
  const ranked: RankedResult[] = results.flatMap((result) =>
    recordOf(index, result).map((record) => ({
      record,
      score: result.score,
      terms: result.terms,
      keyLength: record.citationKey?.startsWith(whole)
        ? record.citationKey.length
        : null,
    })),
  );
  ranked.sort(compareRanked);
  const top = ranked.slice(0, limit);

  const terms = new Set<string>();
  for (const result of top) for (const term of result.terms) terms.add(term);
  const highlightRe = buildHighlightRegex(terms);

  return top.map(({ record }) =>
    hitOf(
      record,
      highlightRe && record.title
        ? highlightRanges(highlightRe, record.title)
        : [],
    ),
  );
}

function compareRanked(a: RankedResult, b: RankedResult): number {
  if (a.keyLength !== null || b.keyLength !== null) {
    if (a.keyLength === null) return 1;
    if (b.keyLength === null) return -1;
    return a.keyLength - b.keyLength || a.record.order - b.record.order;
  }
  return b.score - a.score || a.record.order - b.record.order;
}

function recordOf(index: EngineIndex, result: SearchResult): IndexedRecord[] {
  const record = index.byId.get(result.id as number);
  return record ? [record] : [];
}

function hitOf(record: IndexedRecord, matches: SearchMatches): ItemHit {
  return {
    itemID: record.itemID,
    indexedKey: record.indexedKey,
    libraryID: record.libraryID,
    matches,
  };
}

function queryTokens(
  query: string,
  words: (text: string) => string[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of words(query)) {
    const normalized = normalize(token);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function toSearchDocument(
  item: IndexedItem,
  languageLookup: LanguageNameLookup | null,
): IndexedSearchDocument {
  const language = parseItemLanguage(item.language, languageLookup);
  return {
    id: item.itemID,
    title: item.title ?? "",
    shortTitle: item.shortTitle ?? "",
    creators: item.creators
      .map((creator) => formatCreator(creator, language))
      .filter((name) => name.length > 0)
      .join("; "),
    publicationTitle: item.publicationTitle ?? "",
    court: item.court ?? "",
    citationKey: item.citationKey ?? "",
    key: item.key,
    year: parseItemDate(item.date)?.year?.toString() ?? "",
  };
}

function processTerm(term: string): string | null {
  const normalized = normalize(term);
  return normalized.length > 0 ? normalized : null;
}

function buildHighlightRegex(terms: ReadonlySet<string>): RegExp | null {
  if (terms.size === 0) return null;
  const escaped = [...terms]
    .sort((a, b) => b.length - a.length)
    .map((v) => RegExp.escape(v));
  return new RegExp(`\\b(${escaped.join("|")})`, "giu");
}

function highlightRanges(re: RegExp, title: string): SearchMatches {
  if (!title) return [];

  const { normalized, indexMap } = normalizeWithIndexMap(title);

  const ranges: SearchMatches = [];
  for (const match of normalized.matchAll(re)) {
    ranges.push([
      indexMap[match.index]!,
      indexMap[match.index + match[0].length]!,
    ]);
  }
  return ranges;
}
