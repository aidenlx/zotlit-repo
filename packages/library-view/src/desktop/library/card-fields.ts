import { resolveVenue } from "@zotlit/db";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { runtime } from "@zotlit/plugin-messages/runtime.ts";
import type { QueryViewValue } from "@zotlit/query-views/desktop/item-query/query-view.ts";
import { holdsPdf } from "@zotlit/query-views/desktop/query-view/papers-layout.tsx";
import { fieldLabel } from "@zotlit/query-views/desktop/query-view/view-properties.ts";
import { FIELD_ALIASES } from "@zotlit/zotero-types";
import { FIELD_LABELS } from "@zotlit/zotero-types/field-labels";
import { ITEM_TYPES } from "@zotlit/zotero-types/item-types";

type Values = Readonly<Record<string, QueryViewValue>>;

const OWN_PATHS = [
  "itemType",
  "creators",
  "dateAdded",
  "dateModified",
  "collections",
  "tags",
  "attachments[].indexedKey",
  "attachments[].title",
  "attachments[].fileType",
  "notes",
  "annotations[].indexedKey",
  "annotations[].color",
] as const;

export const CARD_PATHS: readonly string[] = [
  ...new Set([...Object.keys(FIELD_LABELS["en-US"]), ...OWN_PATHS]),
];

export interface CardField {
  readonly name: string;
  readonly label: string;
  readonly text: string;
  readonly href?: string;
}

export function text(value: QueryViewValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function list(
  value: QueryViewValue | undefined,
): readonly QueryViewValue[] {
  return Array.isArray(value) ? value : [];
}

export function record(value: QueryViewValue | undefined): Values | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Values)
    : null;
}

const locale = () => runtime.getLocale();

function itemDateText(value: QueryViewValue | undefined): string {
  const date = record(value);
  if (!date) return text(value);
  const own = text(date.text);
  if (own !== "") return own;
  const { year, month, day } = date;
  if (typeof year !== "number") return "";
  if (typeof month !== "number") return String(year);
  const at = Temporal.PlainDate.from({
    year,
    month,
    day: typeof day === "number" ? day : 1,
  });
  return at.toLocaleString(locale(), {
    year: "numeric",
    month: "long",
    ...(typeof day === "number" && { day: "numeric" }),
  });
}

function timestampText(value: QueryViewValue | undefined): string {
  const raw = text(value);
  if (raw === "") return "";
  try {
    const at = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? Temporal.PlainDate.from(raw)
      : Temporal.Instant.from(raw);
    return at.toLocaleString(locale(), { dateStyle: "long" });
  } catch {
    return raw;
  }
}

function fieldText(name: string, value: QueryViewValue | undefined): string {
  if (name === "accessDate" || name === "dateAdded" || name === "dateModified")
    return timestampText(value);
  return record(value) ? itemDateText(value) : text(value);
}

function typeHas(type: string, name: string): boolean {
  return typeFields(type).some(
    (field) => field === name || FIELD_ALIASES[field] === name,
  );
}

function ownText(values: Values, name: string): string {
  return typeHas(text(values.itemType), name) ? text(values[name]) : "";
}

function volumeText(values: Values): string {
  const volume = ownText(values, "volume");
  const issue = ownText(values, "issue");
  return `${volume}${issue === "" ? "" : `(${issue})`}`;
}

function venueOf(values: Values): { text: string; from: string } | null {
  const venue = resolveVenue({
    publicationTitle: text(values.publicationTitle) || null,
    publisher: text(values.publisher) || null,
    volume: null,
    issue: null,
    pages: null,
  });
  if (venue === null) return null;
  return {
    text: venue,
    from:
      text(values.publicationTitle) === venue
        ? "publicationTitle"
        : "publisher",
  };
}

function yearOf(values: Values): string {
  const year = record(values.date)?.year;
  return typeof year === "number" ? String(year) : "";
}

const WEB = /^https?:\/\//i;

export const CREATOR_CAP = 10;

function creatorName(creator: Values): string {
  return (
    text(creator.fullName) ||
    text(creator.literal) ||
    [text(creator.given), text(creator.family)]
      .filter((part) => part !== "")
      .join(" ")
  );
}

function creatorsOf(value: QueryViewValue | undefined): Values[] {
  return list(value).flatMap((entry) => {
    const creator = record(entry);
    return creator ? [creator] : [];
  });
}

export interface CardHeader {
  readonly title: string;
  readonly itemType: string;
  readonly type: string | null;
  readonly creators: string;
  readonly venue: string;
  readonly doi: { readonly text: string; readonly href: string } | null;
  readonly citationKey: string | null;
  readonly pdf: boolean;
}

const SHOWN_ELSEWHERE = [
  "title",
  "abstractNote",
  "volume",
  "issue",
  "pages",
  "DOI",
  "citationKey",
  "dateAdded",
];

export function cardHeader(values: Values): CardHeader {
  const creators = creatorsOf(values.creators);
  const role = creators[0]?.role;
  const names = creators
    .filter((creator) => creator.role === role)
    .map(creatorName)
    .filter((name) => name !== "");
  const shownNames = names.slice(0, CREATOR_CAP).join(", ");
  const venue = venueOf(values);
  const source = [venue?.text ?? "", volumeText(values), text(values.pages)]
    .filter((part) => part !== "")
    .join(", ");
  const doi = text(values.DOI);
  const citationKey = text(values.citationKey);
  const itemType = text(values.itemType);
  return {
    title: text(values.title),
    itemType,
    type: itemTypeLabel(itemType),
    creators:
      names.length > CREATOR_CAP
        ? m.query_view_papers_more_creators({ names: shownNames })
        : shownNames,
    venue: [source, yearOf(values)].filter((part) => part !== "").join(" · "),
    doi:
      doi === ""
        ? null
        : { text: doi, href: WEB.test(doi) ? doi : `https://doi.org/${doi}` },
    citationKey: citationKey === "" ? null : citationKey,
    pdf: holdsPdf(values),
  };
}

export function addedText(values: Values): string | null {
  return timestampText(values.dateAdded) || null;
}

function shownInHeader(values: Values): Set<string> {
  const shown = new Set(SHOWN_ELSEWHERE);
  const venue = venueOf(values);
  if (venue) shown.add(venue.from);
  const date = record(values.date);
  if (!date || typeof date.month !== "number") shown.add("date");
  return shown;
}

function typeFields(type: string): readonly string[] {
  const own = ITEM_TYPES.find((entry) => entry.name === type)?.fields;
  if (own) return own;
  return Object.keys(FIELD_LABELS["en-US"]).filter(
    (name) => !(name in FIELD_ALIASES),
  );
}

export function otherFields(values: Values): CardField[] {
  const shown = shownInHeader(values);
  const fields: CardField[] = [];
  const add = (name: string, value: string, href?: string) => {
    if (value !== "")
      fields.push({
        name,
        label: fieldLabel(name),
        text: value,
        ...(href !== undefined && { href }),
      });
  };
  const creators = creatorsOf(values.creators);
  const role = creators[0]?.role;
  if (
    creators.length > CREATOR_CAP ||
    creators.some((creator) => creator.role !== role)
  )
    add(
      "creators",
      creators
        .map(creatorName)
        .filter((name) => name !== "")
        .join("; "),
    );
  for (const name of typeFields(text(values.itemType))) {
    if (shown.has(name) || shown.has(FIELD_ALIASES[name] ?? name)) continue;
    const value = fieldText(name, values[name]);
    add(name, value, name === "url" && WEB.test(value) ? value : undefined);
  }
  add("dateModified", fieldText("dateModified", values.dateModified));
  return fields;
}

export function itemTypeLabel(type: string): string | null {
  const entry = ITEM_TYPES.find((each) => each.name === type);
  if (!entry) return null;
  return entry.labels[locale() === "zh-CN" ? "zh-CN" : "en-US"];
}
