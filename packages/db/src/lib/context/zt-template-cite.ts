import type { ItemDate } from "#lib/zt-date.ts";
import type { ItemExtra } from "#lib/zt-extra.ts";
import type { Item } from "#queries/items.ts";

import { emptyToNull } from "./normalize.ts";
import { cslToTemplateItem } from "./zt-csl.ts";
import { itemToTemplateBaseData } from "./zt-template-item.ts";
import type {
  TemplateCreator,
  TemplateItemBaseData,
} from "./zt-template-item.ts";

/**
 * A cited item's data, in the same template vocabulary as the note root and
 * narrowed to the fields both a live Zotero item and a note's embedded
 * CSL-JSON snapshot supply. Vault and library context — tags,
 * dates-added/modified, library identity, and the note resolvers — stays on
 * the note root, which the embedded snapshot cannot express. An unresolved
 * reference becomes a stub with every field null, so a citation template never
 * null-checks the item itself.
 */
export interface TemplateCiteItemData {
  /** Zotero item type, e.g. `"journalArticle"`, `"book"`. */
  itemType: string | null;
  /** Every creator on the item, in Zotero's own order. */
  creators: readonly TemplateCreator[];
  /** The creator role Zotero treats as primary for this item type. */
  primaryCreatorType: string | null;
  /** Item title. */
  title: string | null;
  /** Abstract text; the CSL-inspired rename of Zotero's `abstractNote`. */
  abstract: string | null;
  /** Journal or container title; the CSL-inspired rename of `publicationTitle`. */
  containerTitle: string | null;
  /** Citation key, from Zotero's native citation key field, where Better BibTeX writes the keys it generates. */
  citationKey: string | null;
  /** Alias for {@link citationKey}; both stay accessible on the item. */
  citekey: string | null;
  /** Publication date, parsed from Zotero's multipart `date` field. */
  date: ItemDate | null;
  /** Short title. */
  shortTitle: string | null;
  /** Digital Object Identifier. */
  DOI: string | null;
  /** Item URL. */
  url: string | null;
  /** ISBN. */
  ISBN: string | null;
  /** ISSN. */
  ISSN: string | null;
  /** Volume. */
  volume: string | null;
  /** Issue. */
  issue: string | null;
  /** Page range. */
  pages: string | null;
  /** Publisher. */
  publisher: string | null;
  /** Place of publication. */
  place: string | null;
  /** Edition. */
  edition: string | null;
  /** Language, verbatim as Zotero stores it, e.g. `"en-US"`, `"English"`. */
  language: string | null;
  /** Parsed view of Zotero's free-text `extra` field; `null` when empty. */
  extra: ItemExtra | null;
  /** Additional Zotero fields beyond the explicitly typed ones above. */
  [field: string]: unknown;
}

/**
 * One cited item within a Citation: the pure item data plus the
 * citation-scoped properties, which never live on the item. Exposed to the
 * Citation Template as `zt.citations`, with `zt.items` the same items bare.
 */
export interface CitationTemplateItem {
  /** Never null; a stub with null fields when the ref is unresolved. */
  item: TemplateCiteItemData;
  /** Pinpoint reference, e.g. `"62"`; `null` when the Citation names none. */
  locator: string | null;
  /** Raw CSL locator label, e.g. `"page"`. */
  label: string | null;
  /** Pandoc-style abbreviation, e.g. `"p."`; `"page"`/absent → `"p."`. */
  labelShort: string;
  /** The Citation suppresses the author's name; `false` by default. */
  suppressAuthor: boolean;
  /** Text rendered before the Citation, e.g. `"see"`. */
  prefix: string | null;
  /** Text rendered after the Citation, e.g. `"for a review"`. */
  suffix: string | null;
}

/**
 * The gesture a Citation was requested with, handed to the Citation Template
 * as `zt.variant`: `"main"` for Enter, `"alt"` for Shift+Enter or a trailing
 * `/` in the suggester query. The enum names the gesture alone — the Citation
 * Template decides what each variant renders.
 */
export type CitationVariant =
  /** Enter in the suggester, the insert modal, and an annotation's `citation`. */
  | "main"
  /** Shift+Enter, or a trailing `/` in the suggester query. */
  | "alt";

export const CITATION_VARIANTS = [
  "main",
  "alt",
] as const satisfies readonly CitationVariant[];

export const DEFAULT_CITATION_VARIANT: CitationVariant = "main";

export function isCitationVariant(value: unknown): value is CitationVariant {
  return (CITATION_VARIANTS as readonly unknown[]).includes(value);
}

/** The citation-template data root (`zt`): `citations[i].item === items[i]`. */
export interface CitationTemplateData {
  /** The gesture this Citation was requested with. */
  variant: CitationVariant;
  /** The cited items bare, in Citation order. */
  items: readonly TemplateCiteItemData[];
  /**
   * The Citation Items: each pairs a cited item with the citation-scoped
   * properties the Pandoc Citation formatter reads.
   *
   * @example
   * ```liquid
   * {{ zt.citations | pandoc_cite }}
   * ```
   */
  citations: readonly CitationTemplateItem[];
}

export interface CiteRef {
  citationKey: string | null;
  item?: Item | TemplateCiteItemData;
  locator?: string | null;
  label?: string | null;
  labelShort?: string;
  suppressAuthor?: boolean;
  prefix?: string | null;
  suffix?: string | null;
}

export type ResolvedCiteRef = Required<Omit<CiteRef, "item">> &
  Pick<CiteRef, "item">;

export function citekeysToCiteTemplateData(
  refs: readonly CiteRef[],
  variant: CitationVariant,
): CitationTemplateData {
  const citations = refs.map((ref) => {
    const item = ref.item
      ? isDbItem(ref.item)
        ? narrowToCiteItemData(ref.item, ref.citationKey)
        : {
            ...ref.item,
            citationKey: emptyToNull(ref.citationKey),
            citekey: emptyToNull(ref.citationKey),
          }
      : stubCiteItem(ref.citationKey);
    return toCitationItem(item, ref);
  });
  return { variant, items: citations.map((c) => c.item), citations };
}

function isDbItem(item: Item | TemplateCiteItemData): item is Item {
  return "fields" in item;
}

function narrowToCiteItemData(
  item: Item,
  citationKey: string | null,
): TemplateCiteItemData {
  return narrowBaseDataToCiteItemData(
    itemToTemplateBaseData({ item, tags: [] }),
    citationKey,
  );
}

export function narrowBaseDataToCiteItemData(
  base: TemplateItemBaseData,
  citationKey: string | null,
): TemplateCiteItemData {
  const {
    key: _key,
    groupID: _groupID,
    libraryID: _libraryID,
    indexedKey: _indexedKey,
    dateAdded: _dateAdded,
    dateModified: _dateModified,
    tags: _tags,
    notePath: _notePath,
    noteLink: _noteLink,
    ...rest
  } = base;
  const key = emptyToNull(citationKey);
  return {
    ...rest,
    citationKey: key,
    citekey: key,
  };
}

export function resolveCitedItem(
  dbItem: Item | undefined,
  snapshot: Record<string, unknown> | undefined,
  citationKey: string | null,
): TemplateCiteItemData {
  if (dbItem) return narrowToCiteItemData(dbItem, citationKey);
  if (snapshot) {
    const key = emptyToNull(citationKey);
    return {
      ...cslToTemplateItem(snapshot),
      citationKey: key,
      citekey: key,
    };
  }
  return stubCiteItem(citationKey);
}

function stubCiteItem(citationKey: string | null): TemplateCiteItemData {
  const key = emptyToNull(citationKey);
  return {
    itemType: null,
    creators: [],
    primaryCreatorType: null,
    title: null,
    abstract: null,
    containerTitle: null,
    citationKey: key,
    citekey: key,
    date: null,
    shortTitle: null,
    DOI: null,
    url: null,
    ISBN: null,
    ISSN: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: null,
    place: null,
    edition: null,
    language: null,
    extra: null,
  };
}

export const DEFAULT_LOCATOR_LABEL_SHORT = "p.";

function toCitationItem(
  item: TemplateCiteItemData,
  props: Omit<CiteRef, "citationKey"> = {},
): CitationTemplateItem {
  return {
    item,
    locator: emptyToNull(props.locator ?? null),
    label: emptyToNull(props.label ?? null),
    labelShort: props.labelShort ?? DEFAULT_LOCATOR_LABEL_SHORT,
    suppressAuthor: props.suppressAuthor ?? false,
    prefix: emptyToNull(props.prefix ?? null),
    suffix: emptyToNull(props.suffix ?? null),
  };
}
