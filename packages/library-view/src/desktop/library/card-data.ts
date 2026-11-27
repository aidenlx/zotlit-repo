import { ANNOTATION_COLORS } from "@zotlit/plugin-kernel/annotation-colors.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { QueryViewValue } from "@zotlit/query-views/worker/item-query/query-view.ts";

import {
  addedText,
  cardHeader,
  list,
  otherFields,
  record,
  text,
} from "./card-fields.ts";
import type { CardField, CardHeader } from "./card-fields.ts";
export type Values = Readonly<Record<string, QueryViewValue>>;

export interface CardFile {
  readonly key: string;
  readonly title: string;
  readonly fileType: string;
}

export interface CardNote {
  readonly key: string;
  readonly title: string;
}

export interface CardColour {
  readonly color: string;
  readonly count: number;
}

export interface CardQuote {
  readonly key: string;
  readonly color: string;
  readonly kind: "quote" | "note" | "image";
  readonly text: string;
  readonly page: string;
}

export interface CardItem extends CardHeader {
  fields: readonly CardField[];
  abstract: string | null;
  where: readonly (readonly string[])[];
  tags: readonly string[];
  files: readonly CardFile[];
  notes: readonly CardNote[];
  added: string | null;
  annotations: number;
  colours: readonly CardColour[];
  quotes: readonly CardQuote[];
}

export const QUOTED = 2;

export const QUOTE_PATHS = [
  "type",
  "text",
  "comment",
  "color",
  "pageLabel",
] as const;

export function quoteOf(key: string, values: Values): CardQuote {
  const type = text(values.type);
  const quoted = text(values.text);
  const comment = text(values.comment);
  const kind =
    type === "image" || type === "ink"
      ? "image"
      : quoted === "" && comment !== ""
        ? "note"
        : "quote";
  return {
    key,
    color: text(values.color).toLowerCase(),
    kind,
    text:
      kind === "image"
        ? type === "ink"
          ? m.library_view_card_annotation_ink()
          : m.library_view_card_annotation_image()
        : kind === "note"
          ? comment
          : quoted,
    page: text(values.pageLabel),
  };
}

function coloursOf(values: Values): CardColour[] {
  const counts = new Map<string, number>();
  for (const value of list(values["annotations[].color"])) {
    const color = text(value).toLowerCase();
    if (color !== "") counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  const place = (color: string) => {
    const at = ANNOTATION_COLORS.indexOf(color);
    return at === -1 ? ANNOTATION_COLORS.length : at;
  };
  return [...counts]
    .map(([color, count]) => ({ color, count }))
    .toSorted((a, b) => place(a.color) - place(b.color));
}

export function previewItem(values: Values): CardItem {
  return {
    ...cardHeader(values),
    fields: [],
    abstract: null,
    where: [],
    tags: [],
    files: [],
    notes: [],
    added: null,
    annotations: 0,
    colours: [],
    quotes: [],
  };
}

export function cardItem(
  values: Values,
  library: string | null,
  quotes: readonly CardQuote[],
): CardItem {
  const abstract = text(values.abstractNote);
  const paths = list(values.collections).flatMap((path) =>
    typeof path === "string" && path !== "" ? [path.split("/")] : [],
  );
  const lead = library === null ? [] : [library];
  const keys = list(values["attachments[].indexedKey"]);
  const titles = list(values["attachments[].title"]);
  const kinds = list(values["attachments[].fileType"]);
  return {
    ...cardHeader(values),
    fields: otherFields(values),
    abstract: abstract === "" ? null : abstract,
    where:
      paths.length > 0
        ? paths.map((path) => [...lead, ...path])
        : lead.length > 0
          ? [lead]
          : [],
    tags: list(values.tags).flatMap((tag) => {
      const name = text(record(tag)?.name);
      return name === "" ? [] : [name];
    }),
    files: keys.flatMap((key, index) =>
      typeof key === "string"
        ? [
            {
              key,
              title: text(titles[index]) || key,
              fileType: text(kinds[index]),
            },
          ]
        : [],
    ),
    notes: list(values.notes).flatMap((entry) => {
      const note = record(entry);
      const key = text(note?.indexedKey);
      return key === "" ? [] : [{ key, title: text(note?.title) || key }];
    }),
    added: addedText(values),
    annotations: list(values["annotations[].indexedKey"]).length,
    colours: coloursOf(values),
    quotes,
  };
}
