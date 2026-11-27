import type { ZoteroUserIdentity } from "#queries/account.ts";
import type { Creator, Item } from "#queries/items.ts";

import { FIELD_ALIASES } from "@zotlit/zotero-types";
import {
  CREATOR_TYPE_TO_CSL_NAME,
  CSL_DATE_FIELD_MAP,
  CSL_TEXT_FIELD_CANDIDATES,
  ITEM_TYPE_TO_CSL_TYPE,
} from "@zotlit/zotero-types/csl";
import { isMultipartDate } from "@zotlit/zotero-types/date";

import { parseNameParticles } from "./zt-csl-name.ts";
import type { CslPersonName } from "./zt-csl-name.ts";
import { parseItemDate } from "./zt-date.ts";
import type { ItemDate } from "./zt-date.ts";
import { extraToCsl } from "./zt-extra-to-csl.ts";
import { itemUri } from "./zt-uri.ts";

export type CslName = CslPersonName | { literal: string };

export type CslDate =
  | {
      "date-parts": [[number] | [number, number] | [number, number, number]];
      season?: string;
    }
  | { literal: string };

export interface CslItemData {
  id: string;
  type: string;
  [variable: string]: unknown;
}

const EVENT_PLACE_ITEM_TYPES: ReadonlySet<string> = new Set([
  "audioRecording",
  "presentation",
  "videoRecording",
]);

const FIRST_ISBN_RE = /^(?:97[89]-?)?(?:\d-?){9}[\dx](?!-)\b/i;

export function itemToCsl(
  item: Item,
  user: Pick<ZoteroUserIdentity, "userID" | "localUserKey">,
): CslItemData {
  const { itemType } = item.fields;
  const fields = itemFieldValues(item);
  return {
    id: itemUri(item.key, item.groupID, user) ?? item.indexedKey,
    type: cslItemType(itemType),
    ...textVariables(fields, itemType),
    ...nameVariables(item),
    ...dateVariables(fields),
  };
}

function cslItemType(itemType: string): string {
  const cslType = ITEM_TYPE_TO_CSL_TYPE[itemType];
  if (!cslType) throw new Error(`Unexpected Zotero Item type "${itemType}"`);
  return cslType;
}

function itemFieldValues(item: Item): ReadonlyMap<string, string> {
  const fields = new Map<string, string>();
  const put = (name: string, value: string | null | undefined): void => {
    if (typeof value === "string" && value !== "" && !fields.has(name))
      fields.set(name, value);
  };
  for (const [name, value] of Object.entries(item.fields)) {
    if (name === "itemType" || typeof value !== "string") continue;
    put(name, value);
    const baseField = FIELD_ALIASES[name];
    if (baseField) put(baseField, value);
  }
  for (const [name, value] of item.customFields) put(name, value);
  return fields;
}

function textVariables(
  fields: ReadonlyMap<string, string>,
  itemType: string,
): Record<string, string> {
  const isEventPlaceType = EVENT_PLACE_ITEM_TYPES.has(itemType);
  const variables: Record<string, string> = {};
  for (const [variable, defaultCandidates] of Object.entries(
    CSL_TEXT_FIELD_CANDIDATES,
  )) {
    if (variable === "shortTitle") continue;
    if (isEventPlaceType && variable === "publisher-place") continue;
    const candidates =
      isEventPlaceType && variable === "event-place"
        ? ["place"]
        : defaultCandidates;
    for (const field of candidates) {
      const value = fields.get(field);
      if (value === undefined) continue;
      const cslValue = field === "ISBN" ? firstIsbn(value) : value;
      variables[variable] = stripEnclosingQuotes(
        field === "extra" ? extraToCsl(cslValue) : cslValue,
      );
      break;
    }
  }
  return variables;
}

function firstIsbn(value: string): string {
  return FIRST_ISBN_RE.exec(value)?.[0] ?? value;
}

function stripEnclosingQuotes(value: string): string {
  return value.startsWith('"') && value.indexOf('"', 1) === value.length - 1
    ? value.slice(1, -1)
    : value;
}

function nameVariables(item: Item): Record<string, CslName[]> {
  const variables: Record<string, CslName[]> = {};
  for (const creator of item.creators) {
    const variable =
      CREATOR_TYPE_TO_CSL_NAME[creator.creatorType] ??
      (creator.creatorType === item.primaryCreatorType ? "author" : null);
    const name = variable && toCslName(creator);
    if (!variable || !name) continue;
    (variables[variable] ??= []).push(name);
  }
  return variables;
}

function toCslName(creator: Creator): CslName | null {
  const { firstName, lastName, fieldMode } = creator;
  if (fieldMode === 1 && lastName && !firstName) return { literal: lastName };
  if (lastName || firstName) {
    const name: CslPersonName = {
      family: lastName ?? "",
      given: firstName ?? "",
    };
    if (name.family && name.given) parseNameParticles(name);
    return name;
  }
  return null;
}

function dateVariables(
  fields: ReadonlyMap<string, string>,
): Record<string, CslDate> {
  const variables: Record<string, CslDate> = {};
  for (const [variable, field] of Object.entries(CSL_DATE_FIELD_MAP)) {
    const raw = fields.get(field);
    const date = parseDateField(
      variable === "accessed" ? localAccessDate(raw) : raw,
    );
    if (date) variables[variable] = toCslDate(date);
  }
  return variables;
}

const SQL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateField(raw: string | undefined): ItemDate | null {
  return parseItemDate(raw && SQL_DATE_RE.test(raw) ? `${raw} ` : raw);
}

function localAccessDate(raw: string | undefined): string | undefined {
  if (!raw || SQL_DATE_RE.test(raw)) return raw;
  const instant = accessDateInstant(raw);
  return instant
    ?.toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toPlainDate()
    .toString();
}

function accessDateInstant(raw: string): Temporal.Instant | null {
  try {
    return Temporal.Instant.from(
      raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`,
    );
  } catch {
    return null;
  }
}

function toCslDate(date: ItemDate): CslDate {
  if (date.kind === "text") {
    return date.year === null
      ? { literal: date.text }
      : yearDateWithSeason(date);
  }
  if (date.month === null) return yearDateWithSeason(date);
  if (date.day === null) return { "date-parts": [[date.year, date.month]] };
  return { "date-parts": [[date.year, date.month, date.day]] };
}

function yearDateWithSeason(date: ItemDate): CslDate {
  if (date.year === null)
    return { literal: date.kind === "text" ? date.text : date.raw };
  const season = yearOnlySeason(date);
  return season
    ? { "date-parts": [[date.year]], season }
    : { "date-parts": [[date.year]] };
}

function yearOnlySeason(date: ItemDate): string | null {
  if (date.year === null || date.month !== null) return null;
  const text = isMultipartDate(date.raw) ? date.raw.slice(11) : date.raw;
  const season = text
    .split(" ")
    .filter((part) => part !== "" && Number.isNaN(Number(part)))
    .join(" ")
    .trim();
  return season || null;
}
