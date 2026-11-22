import * as v from "valibot";

export interface ZoteroRef {
  libraryType: "user" | "group";
  groupID: number | null;
  key: string;
}

export interface CitationItem {
  uris: string[];
  ref: ZoteroRef | null;
  locator?: string;
  label?: string;
  suppressAuthor?: boolean;
  prefix?: string;
  suffix?: string;
}

export interface CitationInfo {
  citationItems: CitationItem[];
}

export interface AnnotationInfo {
  annotationKey: string;
  attachmentURI: string;
  attachment: ZoteroRef | null;
  color?: string;
  pageLabel?: string;
  citationItem?: CitationItem;
}

const ITEM_URI = new URLPattern({
  protocol: "http",
  hostname: "zotero.org",
  pathname: "/:type(users|groups){/local}?/:libraryID/items/:key",
});

export function parseItemUri(uri: string): ZoteroRef | null {
  const groups = ITEM_URI.exec(uri)?.pathname.groups;
  const key = groups?.key;
  if (!key) return null;
  if (groups.type === "groups") {
    const groupID = Number(groups.libraryID);
    if (!Number.isInteger(groupID)) return null;
    return { libraryType: "group", groupID, key };
  }
  return { libraryType: "user", groupID: null, key };
}

const CitationItemSchema = v.object({
  uris: v.array(v.string()),
  locator: v.optional(v.string()),
  label: v.optional(v.string()),
  "suppress-author": v.optional(v.boolean()),
  prefix: v.optional(v.string()),
  suffix: v.optional(v.string()),
});

const CitationSchema = v.object({
  citationItems: v.array(CitationItemSchema),
});

const AnnotationSchema = v.object({
  attachmentURI: v.string(),
  annotationKey: v.string(),
  color: v.optional(v.string()),
  pageLabel: v.optional(v.string()),
  citationItem: v.optional(CitationItemSchema),
});

function parseDataAttribute<TSchema extends v.GenericSchema>(
  schema: TSchema,
  encoded: string | null,
): v.InferOutput<TSchema> | null {
  if (encoded === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(decodeURIComponent(encoded));
  } catch {
    return null;
  }
  const result = v.safeParse(schema, json);
  return result.success ? result.output : null;
}

function toCitationItem(
  raw: v.InferOutput<typeof CitationItemSchema>,
): CitationItem {
  let ref: ZoteroRef | null = null;
  for (const uri of raw.uris) {
    ref = parseItemUri(uri);
    if (ref) break;
  }
  return {
    uris: raw.uris,
    ref,
    ...(raw.locator !== undefined ? { locator: raw.locator } : {}),
    ...(raw.label !== undefined ? { label: raw.label } : {}),
    ...(raw["suppress-author"] !== undefined
      ? { suppressAuthor: raw["suppress-author"] }
      : {}),
    ...(raw.prefix !== undefined ? { prefix: raw.prefix } : {}),
    ...(raw.suffix !== undefined ? { suffix: raw.suffix } : {}),
  };
}

export function parseCitationData(encoded: string | null): CitationInfo | null {
  const data = parseDataAttribute(CitationSchema, encoded);
  if (!data) return null;
  return { citationItems: data.citationItems.map(toCitationItem) };
}

const EmbeddedCitationItemSchema = v.object({
  uris: v.array(v.string()),
  itemData: v.optional(
    v.looseObject({ "citation-key": v.optional(v.string()) }),
  ),
});

export function parseEmbeddedCitationItems(
  encoded: string | null,
): Map<string, string> {
  const map = new Map<string, string>();
  const data = parseDataAttribute(v.array(EmbeddedCitationItemSchema), encoded);
  if (!data) return map;
  for (const entry of data) {
    const citationKey = entry.itemData?.["citation-key"];
    if (!citationKey) continue;
    for (const uri of entry.uris) {
      if (!map.has(uri)) map.set(uri, citationKey);
    }
  }
  return map;
}

export function parseEmbeddedCitationSnapshot(
  encoded: string | null,
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  const data = parseDataAttribute(v.array(EmbeddedCitationItemSchema), encoded);
  if (!data) return map;
  for (const entry of data) {
    if (!entry.itemData) continue;
    for (const uri of entry.uris) {
      if (!map.has(uri)) map.set(uri, entry.itemData);
    }
  }
  return map;
}

export function parseAnnotationData(
  encoded: string | null,
): AnnotationInfo | null {
  const data = parseDataAttribute(AnnotationSchema, encoded);
  if (!data) return null;
  return {
    annotationKey: data.annotationKey,
    attachmentURI: data.attachmentURI,
    attachment: parseItemUri(data.attachmentURI),
    ...(data.color !== undefined ? { color: data.color } : {}),
    ...(data.pageLabel !== undefined ? { pageLabel: data.pageLabel } : {}),
    ...(data.citationItem
      ? { citationItem: toCitationItem(data.citationItem) }
      : {}),
  };
}
