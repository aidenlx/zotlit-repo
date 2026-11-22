import type { ItemDate } from "#lib/zt-date.ts";

import {
  CSL_TEXT_FIELD_MAP,
  CSL_TYPE_MAP,
  CREATOR_TYPE_TO_CSL_NAME,
} from "@zotlit/zotero-types/csl";

import type { TemplateCiteItemData } from "./zt-template-cite.ts";
import type { TemplateCreator } from "./zt-template-item.ts";

import {
  textDate,
  tryDate,
  tryYearMonth,
  withToString,
  yearOnly,
} from "#lib/zt-date.ts";
import { parseItemExtra } from "#lib/zt-extra.ts";

const CSL_NAME_VAR_TO_CREATOR_TYPE: ReadonlyMap<string, string> =
  Object.entries(CREATOR_TYPE_TO_CSL_NAME).reduceRight(
    (map, [creatorType, cslNameVar]) => map.set(cslNameVar, creatorType),
    new Map<string, string>(),
  );

function textFieldsFromCsl(
  csl: Record<string, unknown>,
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [cslVar, ztField] of Object.entries(CSL_TEXT_FIELD_MAP)) {
    const value = csl[cslVar];
    if (typeof value === "string" && !(ztField in fields))
      fields[ztField] = value;
  }
  return fields;
}

function cslNameToCreator(name: unknown, role: string): TemplateCreator {
  const { family, given, literal } = (name ?? {}) as {
    family?: unknown;
    given?: unknown;
    literal?: unknown;
  };
  if (typeof literal === "string") {
    return { family: "", given: "", literal, role, fullName: literal };
  }
  const familyName = typeof family === "string" ? family : "";
  const givenName = typeof given === "string" ? given : "";
  return {
    family: familyName,
    given: givenName,
    literal: null,
    role,
    fullName: `${givenName} ${familyName}`.trim(),
  };
}

function creatorsFromCsl(csl: Record<string, unknown>): TemplateCreator[] {
  const creators: TemplateCreator[] = [];
  for (const [key, value] of Object.entries(csl)) {
    const role = CSL_NAME_VAR_TO_CREATOR_TYPE.get(key);
    if (!role || !Array.isArray(value)) continue;
    for (const name of value) creators.push(cslNameToCreator(name, role));
  }
  return creators;
}

function cslIssuedToItemDate(issued: unknown): ItemDate | null {
  const date = cslIssuedToItemDateInner(issued);
  return date && withToString(date);
}

function cslIssuedToItemDateInner(issued: unknown): ItemDate | null {
  if (!issued || typeof issued !== "object") return null;
  const { literal, "date-parts": parts } = issued as {
    literal?: unknown;
    "date-parts"?: unknown;
  };
  if (typeof literal === "string") return textDate(literal, literal);
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return null;
  const [year, month, day] = parts[0] as unknown[];
  if (typeof year !== "number") return null;
  if (typeof month === "number" && typeof day === "number") {
    return (
      tryDate({ year, month, day }, `${year}-${month}-${day}`) ??
      tryYearMonth({ year, month }, `${year}-${month}`) ??
      yearOnly(year, String(year))
    );
  }
  if (typeof month === "number")
    return (
      tryYearMonth({ year, month }, `${year}-${month}`) ??
      yearOnly(year, String(year))
    );
  return yearOnly(year, String(year));
}

export function cslToTemplateItem(
  csl: Record<string, unknown>,
): TemplateCiteItemData {
  const fields = textFieldsFromCsl(csl);
  const creators = creatorsFromCsl(csl);
  const citationKey = fields.citationKey ?? null;
  return {
    ...fields,
    itemType:
      typeof csl.type === "string" ? (CSL_TYPE_MAP[csl.type] ?? null) : null,
    creators,
    primaryCreatorType: creators[0]?.role ?? null,
    title: fields.title ?? null,
    abstract: fields.abstract ?? null,
    containerTitle: fields.containerTitle ?? null,
    citationKey,
    citekey: citationKey,
    date: cslIssuedToItemDate(csl.issued),
    shortTitle: fields.shortTitle ?? null,
    DOI: fields.DOI ?? null,
    url: fields.url ?? null,
    ISBN: fields.ISBN ?? null,
    ISSN: fields.ISSN ?? null,
    volume: fields.volume ?? null,
    issue: fields.issue ?? null,
    pages: fields.pages ?? null,
    publisher: fields.publisher ?? null,
    place: fields.place ?? null,
    edition: fields.edition ?? null,
    language: fields.language ?? null,
    extra: parseItemExtra(fields.extra),
  };
}
