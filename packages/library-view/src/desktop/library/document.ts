import * as v from "valibot";

import type { FilterTree } from "@zotlit/filter-expression";
import { searchTerms } from "@zotlit/plugin-services/core/item-lookup/search-text.ts";
import {
  parseQueryFile,
  sameSort,
  serializeQueryFile,
} from "@zotlit/query-views/core/query-view/query-file.ts";
import type { QueryFileSort } from "@zotlit/query-views/core/query-view/query-file.ts";
import type {
  QueryViewGroup,
  QueryViewRequest,
  QueryViewRow,
} from "@zotlit/query-views/desktop/item-query/query-view.ts";
import type { LiteratureNotes } from "@zotlit/query-views/desktop/query-view/table-notes.ts";
import type { QueryRowPass } from "@zotlit/query-views/desktop/query-view/view.tsx";
import {
  librarySelectorSchema,
  selectorKey,
} from "@zotlit/zotero-reads/contract/library-scope.ts";
import type {
  LibraryScope,
  LibrarySelector,
} from "@zotlit/zotero-reads/contract/library-scope.ts";

export const READING_STATE_FACETS = [
  "unread",
  "annotated",
  "has-note",
  "pdf",
] as const;
export type ReadingStateFacet = (typeof READING_STATE_FACETS)[number];

export const LIBRARY_LAYOUTS = ["papers"] as const;

export type LibraryNode =
  | { readonly kind: "recent" }
  | { readonly kind: "library"; readonly library: LibrarySelector }
  | {
      readonly kind: "collection";
      readonly library: LibrarySelector;
      readonly path: readonly string[];
    };

export interface LibraryViewDocument {
  readonly node: LibraryNode;
  readonly facets: readonly ReadingStateFacet[];
  readonly tags: readonly string[];
  readonly search: string;
  readonly sort: readonly QueryFileSort[];
  readonly card: ReadingCardDisclosures;
  readonly expanded: readonly string[];
  readonly cardWidth?: number;
  readonly cardHeight?: number;
  readonly cardClosed?: boolean;
  readonly treeWidth?: number;
  readonly treeCollapsed?: boolean;
}

export const CARD_WIDTH_DEFAULT = 384;
export const CARD_WIDTH_MIN = 288;
export const CARD_HEIGHT_DEFAULT = 256;
export const CARD_HEIGHT_MIN = 128;
export const CARD_LIST_MIN = 320;
export const TREE_WIDTH_DEFAULT = 224;
export const TREE_WIDTH_MIN = 160;

export function cardWidthBounds(
  pane: number,
  min = CARD_WIDTH_MIN,
): { min: number; max: number } {
  return {
    min,
    max: Math.max(min, Math.round(pane) - CARD_LIST_MIN),
  };
}

export function clampCardWidth(
  width: number,
  pane?: number,
  floor = CARD_WIDTH_MIN,
): number {
  const { min, max } = cardWidthBounds(pane ?? Number.POSITIVE_INFINITY, floor);
  return Math.round(Math.min(max, Math.max(min, width)));
}

export interface ReadingCardDisclosures {
  readonly allFields: boolean;
  readonly annotations: boolean;
}

const CLOSED_CARD: ReadingCardDisclosures = Object.freeze({
  allFields: false,
  annotations: false,
});

const nodeSchema = v.variant("kind", [
  v.object({ kind: v.literal("recent") }),
  v.object({ kind: v.literal("library"), library: librarySelectorSchema }),
  v.object({
    kind: v.literal("collection"),
    library: librarySelectorSchema,
    path: v.pipe(v.array(v.pipe(v.string(), v.nonEmpty())), v.minLength(1)),
  }),
]);

const sortSchema = v.array(
  v.object({
    property: v.pipe(v.string(), v.nonEmpty()),
    direction: v.picklist(["ASC", "DESC"]),
  }),
);

export type StoredLibraryViewDocument = {
  node: v.InferOutput<typeof nodeSchema>;
  facets: ReadingStateFacet[];
  tags: string[];
  search: string;
  sort: v.InferOutput<typeof sortSchema>;
  card: { allFields: boolean; annotations: boolean };
  expanded: string[];
  cardWidth?: number;
  cardHeight?: number;
  cardClosed?: boolean;
  treeWidth?: number;
  treeCollapsed?: boolean;
};

export const RECENT_SORT: readonly QueryFileSort[] = Object.freeze([
  { property: "lastActivity", direction: "DESC" },
]);

export const DEFAULT_LIBRARY_VIEW_DOCUMENT: LibraryViewDocument = Object.freeze(
  {
    node: { kind: "recent" },
    facets: [],
    tags: [],
    search: "",
    sort: RECENT_SORT,
    card: CLOSED_CARD,
    expanded: [],
  } satisfies LibraryViewDocument,
);

export function nodeKey(node: LibraryNode): string {
  if (node.kind === "recent") return JSON.stringify(["recent"]);
  return JSON.stringify([
    selectorKey(node.library),
    ...(node.kind === "collection" ? node.path : []),
  ]);
}

function ancestors(node: LibraryNode): string[] {
  if (node.kind !== "collection") return [];
  return node.path.slice(0, -1).map((_, index) =>
    nodeKey({
      kind: "collection",
      library: node.library,
      path: node.path.slice(0, index + 1),
    }),
  );
}

function openTo(expanded: readonly string[], node: LibraryNode): string[] {
  return [...new Set([...expanded, ...ancestors(node)])];
}

export function parseLibraryViewDocument(raw: unknown): LibraryViewDocument {
  const stored =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const field = <T>(
    schema: v.GenericSchema<unknown, T>,
    key: keyof LibraryViewDocument,
    fallback: T,
  ): T => {
    const result = v.safeParse(schema, stored[key]);
    return result.success ? result.output : fallback;
  };
  const defaults = DEFAULT_LIBRARY_VIEW_DOCUMENT;
  const facets = field(v.array(v.unknown()), "facets", []);
  const tags = field(v.array(v.unknown()), "tags", []);
  const expanded = field(v.array(v.unknown()), "expanded", []);
  const node = field(nodeSchema, "node", defaults.node);
  const cardWidth = stored.cardWidth;
  const cardHeight = stored.cardHeight;
  const treeWidth = stored.treeWidth;
  return {
    node,
    facets: READING_STATE_FACETS.filter((facet) => facets.includes(facet)),
    tags: sortTags(
      tags.filter(
        (tag): tag is string => typeof tag === "string" && tag !== "",
      ),
    ),
    search: field(v.string(), "search", defaults.search),
    sort: field(sortSchema, "sort", defaults.sort),
    card: field(cardSchema, "card", defaults.card),
    expanded: openTo(
      expanded.filter(
        (key): key is string => typeof key === "string" && key !== "",
      ),
      node,
    ),
    ...(typeof cardWidth === "number" &&
      Number.isFinite(cardWidth) && { cardWidth: clampCardWidth(cardWidth) }),
    ...(typeof cardHeight === "number" &&
      Number.isFinite(cardHeight) && {
        cardHeight: clampCardWidth(cardHeight, undefined, CARD_HEIGHT_MIN),
      }),
    ...(stored.cardClosed === true && { cardClosed: true }),
    ...(typeof treeWidth === "number" &&
      Number.isFinite(treeWidth) && {
        treeWidth: clampCardWidth(treeWidth, undefined, TREE_WIDTH_MIN),
      }),
    ...(stored.treeCollapsed === true && { treeCollapsed: true }),
  };
}

const cardSchema = v.pipe(
  v.unknown(),
  v.transform((raw): ReadingCardDisclosures => {
    const stored =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    return {
      allFields: stored.allFields === true,
      annotations: stored.annotations === true,
    };
  }),
);

export function withCardDisclosure(
  doc: LibraryViewDocument,
  name: keyof ReadingCardDisclosures,
  open: boolean,
): LibraryViewDocument {
  return { ...doc, card: { ...doc.card, [name]: open } };
}

function nodeSort(node: LibraryNode): readonly QueryFileSort[] | null {
  return node.kind === "recent" ? RECENT_SORT : null;
}

export function withNode(
  doc: LibraryViewDocument,
  node: LibraryNode,
): LibraryViewDocument {
  const left = nodeSort(doc.node);
  const sort =
    nodeSort(node) ?? (left && sameSort(doc.sort, left) ? [] : doc.sort);
  return {
    ...doc,
    node,
    sort,
    expanded: openTo(doc.expanded, node),
  };
}

export function withExpanded(
  doc: LibraryViewDocument,
  expanded: Iterable<string>,
): LibraryViewDocument {
  return { ...doc, expanded: [...new Set(expanded)] };
}

export function withCardWidth(
  doc: LibraryViewDocument,
  width: number | undefined,
): LibraryViewDocument {
  const { cardWidth: _, ...rest } = doc;
  return width === undefined || !Number.isFinite(width)
    ? rest
    : { ...rest, cardWidth: clampCardWidth(width) };
}

export function withCardHeight(
  doc: LibraryViewDocument,
  height: number | undefined,
): LibraryViewDocument {
  const { cardHeight: _, ...rest } = doc;
  return height === undefined || !Number.isFinite(height)
    ? rest
    : {
        ...rest,
        cardHeight: clampCardWidth(height, undefined, CARD_HEIGHT_MIN),
      };
}

export function withTreeWidth(
  doc: LibraryViewDocument,
  width: number | undefined,
): LibraryViewDocument {
  const { treeWidth: _, ...rest } = doc;
  return width === undefined || !Number.isFinite(width)
    ? rest
    : {
        ...rest,
        treeWidth: clampCardWidth(width, undefined, TREE_WIDTH_MIN),
      };
}

export function withTreeCollapsed(
  doc: LibraryViewDocument,
  collapsed: boolean,
): LibraryViewDocument {
  const { treeCollapsed: _, ...rest } = doc;
  return collapsed ? { ...rest, treeCollapsed: true } : rest;
}

export function withCardClosed(
  doc: LibraryViewDocument,
  closed: boolean,
): LibraryViewDocument {
  const { cardClosed: _, ...rest } = doc;
  return closed ? { ...rest, cardClosed: true } : rest;
}

export function pruneExpanded(
  doc: LibraryViewDocument,
  know: (key: string) => boolean,
): LibraryViewDocument {
  const expanded = doc.expanded.filter(know);
  return expanded.length === doc.expanded.length ? doc : { ...doc, expanded };
}

export function libraryViewDefaults(node: LibraryNode): {
  sort: readonly QueryFileSort[];
  limit: number;
} {
  return { sort: nodeSort(node) ?? [], limit: LIBRARY_VIEW_ROW_LIMIT };
}

export function withFacets(
  doc: LibraryViewDocument,
  facets: readonly ReadingStateFacet[],
): LibraryViewDocument {
  return {
    ...doc,
    facets: READING_STATE_FACETS.filter((facet) => facets.includes(facet)),
  };
}

export function withTags(
  doc: LibraryViewDocument,
  tags: readonly string[],
): LibraryViewDocument {
  return { ...doc, tags: sortTags(tags) };
}

export function sortTags(tags: Iterable<string>): string[] {
  return [...new Set(tags)].sort((a, b) => TAG_ORDER.compare(a, b));
}

const TAG_ORDER = new Intl.Collator(undefined, { numeric: true });

export function withSearch(
  doc: LibraryViewDocument,
  search: string,
): LibraryViewDocument {
  return { ...doc, search };
}

export function serializeLibraryViewDocument(
  doc: LibraryViewDocument,
): StoredLibraryViewDocument {
  return {
    node:
      doc.node.kind === "recent"
        ? { kind: "recent" }
        : doc.node.kind === "library"
          ? { kind: "library", library: { ...doc.node.library } }
          : {
              kind: "collection",
              library: { ...doc.node.library },
              path: [...doc.node.path],
            },
    facets: [...doc.facets],
    tags: [...doc.tags],
    search: doc.search,
    sort: doc.sort.map(({ property, direction }) => ({ property, direction })),
    card: { ...doc.card },
    expanded: [...doc.expanded],
    ...(doc.cardWidth !== undefined && { cardWidth: doc.cardWidth }),
    ...(doc.cardHeight !== undefined && { cardHeight: doc.cardHeight }),
    ...(doc.cardClosed === true && { cardClosed: true }),
    ...(doc.treeWidth !== undefined && { treeWidth: doc.treeWidth }),
    ...(doc.treeCollapsed === true && { treeCollapsed: true }),
  };
}

export interface LibraryViewLabels {
  readonly papers: string;
}

export type VaultCondition = "has-literature-note" | "no-literature-note";

export interface LibraryViewQuery {
  readonly text: string;
  readonly libraries: LibraryScope;
  readonly rank: readonly string[] | null;
  readonly vault: readonly VaultCondition[];
  readonly node: LibraryNode | null;
}

export const LIBRARY_VIEW_ROW_LIMIT = 1000;

const FACETS: Readonly<
  Record<ReadingStateFacet, { filter?: string; vault?: VaultCondition }>
> = {
  unread: {
    filter: "annotations.isEmpty() && lastRead == null",
    vault: "no-literature-note",
  },
  annotated: { filter: "annotations.length > 0" },
  "has-note": { vault: "has-literature-note" },
  pdf: {
    filter:
      'attachments.filter(value.fileType == "pdf" && value.exists).length > 0',
  },
};

export function libraryViewQuery(
  doc: LibraryViewDocument,
  {
    labels,
    scope,
    keys,
    everywhere,
  }: {
    labels: LibraryViewLabels;
    scope: LibraryScope;
    keys?: readonly string[];
    everywhere?: readonly LibrarySelector[];
  },
): LibraryViewQuery {
  const { node } = doc;
  const { filters, vault } = selectionConditions(
    everywhere === undefined ? node : null,
    doc.facets,
  );
  filters.push(...tagFilters(doc.tags));
  if (keys !== undefined)
    filters.push(
      `[${keys.map((key) => JSON.stringify(key)).join(", ")}].contains(indexedKey)`,
    );
  for (const tag of searchTerms(doc.search).tags)
    filters.push(`tags.contains(${JSON.stringify(tag)})`);
  const text = serializeQueryFile({
    ...(filters.length > 0 && { filters: filterTree(filters) }),
    views: [
      {
        type: LIBRARY_LAYOUTS[0],
        name: labels.papers,
        from: "items",
        ...(doc.sort.length > 0 && { sort: doc.sort }),
        limit: LIBRARY_VIEW_ROW_LIMIT,
        problems: [],
        source: {},
      },
    ],
    problems: [],
    source: {},
  });
  return {
    text,
    libraries: everywhere
      ? { mode: "selected", libraries: [...everywhere] }
      : librariesOf(node, scope),
    rank: keys ?? null,
    vault,
    node: everywhere === undefined || node.kind === "recent" ? node : null,
  };
}

export function withText(
  doc: LibraryViewDocument,
  text: string,
): LibraryViewDocument {
  const view = parseQueryFile(text).views[0];
  if (!view) return doc;
  return { ...doc, sort: view.sort ?? [] };
}

export function librariesOf(
  node: LibraryNode,
  scope: LibraryScope,
): LibraryScope {
  return node.kind === "recent"
    ? scope
    : { mode: "selected", libraries: [node.library] };
}

export function paperCountRequest(library: LibrarySelector): QueryViewRequest {
  return {
    from: "items",
    fields: [],
    group: "collections[]",
    limit: null,
    libraries: { mode: "selected", libraries: [library] },
  };
}

export function tagListRequest(
  node: LibraryNode,
  tags: readonly string[],
  scope: LibraryScope,
): QueryViewRequest {
  const { filters } = selectionConditions(node, []);
  filters.push(...tagFilters(tags));
  return {
    from: "items",
    fields: [],
    group: "tags[].name",
    ...(filters.length > 0 && { filter: filters.join(" && ") }),
    limit: 1,
    libraries: librariesOf(node, scope),
  };
}

export function tagNames(
  groups: readonly Pick<QueryViewGroup, "value">[] | null,
  selected: readonly string[],
): string[] {
  const names = (groups ?? []).flatMap(({ value }) =>
    typeof value === "string" ? [value] : [],
  );
  return sortTags([...names, ...selected]);
}

function tagFilters(tags: readonly string[]): string[] {
  return tags.map((tag) => `tags.contains(${JSON.stringify(tag)})`);
}

export function unreadCount(
  node: LibraryNode,
  notes: Pick<LiteratureNotes, "find">,
): {
  request: QueryViewRequest;
  count: (rows: readonly QueryViewRow[]) => number;
} | null {
  if (node.kind === "recent") return null;
  return nodeCount(node, ["unread"], { scope: { mode: "all" }, notes });
}

export function nodeCount(
  node: LibraryNode,
  facets: readonly ReadingStateFacet[],
  {
    scope,
    notes,
  }: { scope: LibraryScope; notes: Pick<LiteratureNotes, "find"> },
): {
  request: QueryViewRequest;
  count: (rows: readonly QueryViewRow[]) => number;
} {
  const { filters, vault } = selectionConditions(node, facets);
  const pass = vaultPass(vault, notes);
  return {
    request: {
      from: "items",
      fields: [],
      ...(filters.length > 0 && { filter: filters.join(" && ") }),
      limit: null,
      libraries: librariesOf(node, scope),
    },
    count: (rows) =>
      rows.filter(({ indexedKey }) => pass?.keeps(indexedKey) ?? true).length,
  };
}

export function selectionConditions(
  node: LibraryNode | null,
  facets: readonly ReadingStateFacet[],
): { filters: string[]; vault: VaultCondition[] } {
  const filters: string[] = [];
  if (node?.kind === "collection")
    filters.push(`collections.within(${JSON.stringify(node.path.join("/"))})`);
  const vault: VaultCondition[] = [];
  for (const facet of facets) {
    const { filter, vault: condition } = FACETS[facet];
    if (filter !== undefined) filters.push(filter);
    if (condition !== undefined) vault.push(condition);
  }
  return { filters, vault };
}

export function vaultPass(
  vault: readonly VaultCondition[],
  notes: Pick<LiteratureNotes, "find">,
): QueryRowPass | null {
  if (vault.length === 0) return null;
  return {
    key: vault.join(" "),
    keeps: (indexedKey) => {
      const noted = notes.find(indexedKey) !== null;
      return vault.every((condition) =>
        condition === "has-literature-note" ? noted : !noted,
      );
    },
  };
}

export function libraryViewQueryFileText(
  doc: LibraryViewDocument,
  { labels }: { labels: LibraryViewLabels },
): string {
  const { text } = libraryViewQuery(
    { ...doc, search: "" },
    { labels, scope: { mode: "all" } },
  );
  if (doc.node.kind === "recent") return text;
  const file = parseQueryFile(text);
  const library = `library == ${JSON.stringify(selectorKey(doc.node.library))}`;
  const rest =
    file.filters === undefined
      ? []
      : typeof file.filters === "object" && "and" in file.filters
        ? file.filters.and
        : [file.filters];
  return serializeQueryFile({
    ...file,
    filters: rest.length === 0 ? library : { and: [library, ...rest] },
  });
}

export function libraryViewQueryFileLeftOut(doc: LibraryViewDocument): {
  facets: ReadingStateFacet[];
  search: boolean;
} {
  return {
    facets: doc.facets.filter((facet) => FACETS[facet].vault !== undefined),
    search: doc.search.trim() !== "",
  };
}

function filterTree(filters: readonly string[]): FilterTree {
  return filters.length === 1 ? filters[0]! : { and: [...filters] };
}
