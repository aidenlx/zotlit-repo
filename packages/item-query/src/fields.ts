import {
  creatorFieldModeToName,
  creatorTypePriority,
  parseItemDate,
  tagTypeToName,
} from "@zotlit/db";
import type {
  HydratedCreator,
  HydratedItem,
  HydrateRelation,
  ScanRow,
} from "@zotlit/db/item-query";
import { ZOTERO_DATE_FIELDS } from "@zotlit/zotero-types";
import { FIELD_LABELS } from "@zotlit/zotero-types/field-labels";

import type { QueryAnnotation } from "./annotation-fields.ts";
import type { AnnotationNeeds } from "./annotation-hydration.ts";
import type { QueryAttachment } from "./attachment-fields.ts";
import type { AttachmentNeeds } from "./attachment-hydration.ts";
import { compareStrings } from "./collation.ts";
import {
  datePart,
  dayKey,
  fromAccessDate,
  fromItemDate,
  timestamp,
} from "./filter-dates.ts";
import type { FilterRegistry } from "./filter-plan.ts";
import type { FilterValue, FilterValueType } from "./filter-values.ts";
import { isQueryRecord } from "./filter-values.ts";
import { keyField, indexedKeyField } from "./key-fields.ts";
import { libraryField } from "./library-field.ts";
import type { QueryNote } from "./note-fields.ts";
import type { NoteNeeds } from "./note-hydration.ts";
import type { PathSegment } from "./projection-path.ts";
import type { QueryClock } from "./query-clock.ts";
import type { FilterNavigation, RecordVocabulary } from "./record-field.ts";
import { recordField } from "./record-field.ts";
import { definitionFilter } from "./record-field.ts";
import { annotationVocabulary } from "./record-vocabularies.ts";
import { attachmentVocabulary } from "./record-vocabularies.ts";
import { noteVocabulary } from "./record-vocabularies.ts";
import type { ProjectionValue } from "./request.ts";
import type { ProjectionJson } from "./value-text.ts";

export interface QueryItem {
  readonly scan: ScanRow;
  readonly lastUse?: number;
  readonly groupID: number | null;
  readonly hydrated: HydratedItem;
  readonly customFieldNames: readonly string[];
  readonly attachments?: readonly QueryAttachment[];
  readonly annotations?: readonly QueryAnnotation[];
  readonly notes?: readonly QueryNote[];
}

export type ScalarType = "string" | "number" | "boolean";

export type ValueShape =
  | {
      readonly kind: "record";
      readonly vocabulary: () => RecordVocabulary<any, any>;
    }
  | { readonly kind: "scalar"; readonly type: ScalarType }
  | { readonly kind: "json" }
  | {
      readonly kind: "object";
      readonly keys: Readonly<Record<string, ValueShape>>;
    }
  | { readonly kind: "list"; readonly element: ValueShape }
  | { readonly kind: "custom-fields"; readonly value: ValueShape };

export interface FieldNeeds {
  readonly builtIn?: readonly string[];
  readonly custom?: readonly string[] | "all";
  readonly relations?: readonly HydrateRelation[];
  readonly attachments?: readonly AttachmentNeeds[];
  readonly annotations?: readonly AnnotationNeeds[];
  readonly notes?: readonly NoteNeeds[];
}

export type SortKey = string | number | boolean | null;

export interface FieldDefinition<Item = QueryItem, Needs = FieldNeeds> {
  readonly description?: string;
  readonly relation?: () => RecordVocabulary<any, any>;
  readonly project?: (
    item: Item,
    rest: readonly PathSegment[],
  ) => ProjectionValue;
  readonly filterNeeds?: Needs;
  readonly navigation?: FilterNavigation<Needs>;
  readonly shape: ValueShape;
  readonly valueForms?: readonly string[];
  readonly needs: (rest: readonly PathSegment[]) => Needs;
  readonly read: (item: Item) => ProjectionValue;
  readonly sortKey?: (item: Item, clock: QueryClock) => SortKey;
  readonly valueSortKey?: (value: ProjectionJson) => SortKey;
  readonly filter?: FilterValueDefinition<Item>;
}

export interface FilterValueDefinition<Item = QueryItem> {
  readonly type: Exclude<FilterValueType, "null">;
  readonly read: (item: Item) => FilterValue;
}

const STRING: ValueShape = { kind: "scalar", type: "string" };
const NUMBER: ValueShape = { kind: "scalar", type: "number" };

const DATE_SHAPE: ValueShape = {
  kind: "object",
  keys: {
    kind: STRING,
    value: STRING,
    year: NUMBER,
    month: NUMBER,
    day: NUMBER,
    text: STRING,
    raw: STRING,
  },
};

const NO_NEEDS = (): FieldNeeds => ({});

function fromScan(readers: {
  read: (row: ScanRow) => ProjectionValue;
  sortKey: (row: ScanRow) => SortKey;
  filter: FilterValueDefinition;
}): FieldDefinition {
  const { read, sortKey, filter } = readers;
  return {
    shape: STRING,
    needs: NO_NEEDS,
    read: (item) => read(item.scan),
    sortKey: (item) => sortKey(item.scan),
    filter,
  };
}

function scanTimestamp(column: "dateAdded" | "dateModified"): FieldDefinition {
  const instant = (row: ScanRow) => {
    const milliseconds = row[column];
    return milliseconds === null
      ? null
      : Temporal.Instant.fromEpochMilliseconds(milliseconds);
  };
  return fromScan({
    read: instant,
    sortKey: (row) => row[column],
    filter: {
      type: "date",
      read: (item) => {
        const value = instant(item.scan);
        return value && timestamp(value);
      },
    },
  });
}

function zoteroField(name: string): FieldDefinition {
  const builtIn = [name];
  const read = (item: QueryItem) => item.hydrated.fields.get(name) ?? null;
  if (name === "accessDate") return accessDateField(builtIn, read);
  if (!isDateField(name)) {
    return {
      shape: STRING,
      needs: () => ({ builtIn }),
      read,
      sortKey: read,
      filter: { type: "string", read },
    };
  }
  return {
    shape: DATE_SHAPE,
    needs: () => ({ builtIn }),
    read: (item) => dateValue(read(item)),
    sortKey: (item) => firstDay(dateValue(read(item)) as ProjectionJson),
    valueSortKey: firstDay,
    filter: {
      type: "date",
      read: (item) => fromItemDate(parseItemDate(read(item))),
    },
  };
}

function accessDateField(
  builtIn: readonly string[],
  read: (item: QueryItem) => string | null,
): FieldDefinition {
  const value = (item: QueryItem) => fromAccessDate(read(item));
  return {
    shape: STRING,
    needs: () => ({ builtIn }),
    read: (item) => {
      const date = value(item);
      if (!date) return null;
      return date.precision === "instant" ? date.instant : date.first;
    },
    sortKey: (item, clock) => {
      const date = value(item);
      return date && datePart(date, "timestamp", clock);
    },
    filter: { type: "date", read: value },
  };
}

function isDateField(name: string): boolean {
  const dateFields: readonly string[] = ZOTERO_DATE_FIELDS;
  return dateFields.includes(name);
}

function dateValue(raw: string | null): ProjectionValue {
  const date = parseItemDate(raw);
  if (!date) return null;
  return {
    kind: date.kind,
    value: date.value,
    year: date.year,
    month: date.month,
    day: date.day,
    text: date.kind === "text" ? date.text : null,
    raw: date.raw,
  };
}

function firstDay(date: ProjectionJson): SortKey {
  if (!isJsonRecord(date) || typeof date.year !== "number") return null;
  return dayKey({
    year: date.year,
    month: typeof date.month === "number" ? date.month : 1,
    day: typeof date.day === "number" ? date.day : 1,
  });
}

function isJsonRecord(
  value: ProjectionJson,
): value is { readonly [key: string]: ProjectionJson } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function projectedSortKey(name: string, value: ProjectionJson): SortKey {
  const definition = FIELDS.get(name);
  if (definition?.valueSortKey) return definition.valueSortKey(value);
  if (value === null || typeof value !== "object") return value;
  return JSON.stringify(value);
}

export const CUSTOM_FIELD_VALUE_SHAPE: ValueShape = STRING;

const customField: FieldDefinition = {
  shape: { kind: "custom-fields", value: CUSTOM_FIELD_VALUE_SHAPE },
  needs: (rest) =>
    typeof rest[0] === "string" ? { custom: [rest[0]] } : { custom: "all" },
  read: (item) =>
    Object.fromEntries(
      item.customFieldNames.map((name) => [
        name,
        item.hydrated.custom.get(name) ?? null,
      ]),
    ),
};

const CREATOR_SHAPE: ValueShape = {
  kind: "object",
  keys: {
    family: STRING,
    given: STRING,
    literal: STRING,
    role: STRING,
    fullName: STRING,
  },
};

const creatorsField: FieldDefinition = {
  shape: { kind: "list", element: CREATOR_SHAPE },
  needs: () => ({ relations: ["creators"] }),
  read: (item) => (item.hydrated.creators ?? []).map(templateCreator),
  filter: {
    type: "list",
    read: (item) => (item.hydrated.creators ?? []).map(fullName),
  },
};

function isOneFieldName(creator: HydratedCreator): boolean {
  return creatorFieldModeToName(creator.fieldMode) === "nameOnly";
}

function fullName(creator: HydratedCreator): string {
  return isOneFieldName(creator)
    ? creator.lastName
    : `${creator.firstName} ${creator.lastName}`.trim();
}

function templateCreator(creator: HydratedCreator): ProjectionValue {
  if (isOneFieldName(creator)) {
    return {
      family: "",
      given: "",
      literal: creator.lastName,
      role: creator.creatorType,
      fullName: fullName(creator),
    };
  }
  return {
    family: creator.lastName,
    given: creator.firstName,
    literal: null,
    role: creator.creatorType,
    fullName: fullName(creator),
  };
}

function firstAuthor(item: QueryItem): HydratedCreator | undefined {
  const creators = item.hydrated.creators ?? [];
  const primaryType =
    creators.find((creator) => creator.primary)?.creatorType ?? null;
  for (const role of creatorTypePriority(primaryType)) {
    const creator = creators.find((creator) => creator.creatorType === role);
    if (creator) return creator;
  }
  return undefined;
}

function creatorSortKey(creator: ProjectionJson): SortKey {
  if (!isJsonRecord(creator)) return null;
  const { family, given, literal } = creator;
  if (typeof literal === "string") return literal;
  if (typeof family !== "string") return null;
  return typeof given === "string" && given !== ""
    ? `${family}, ${given}`
    : family;
}

const CREATOR_NEEDS = (): FieldNeeds => ({ relations: ["creators"] });

const firstAuthorField: FieldDefinition = {
  shape: CREATOR_SHAPE,
  needs: CREATOR_NEEDS,
  read: (item) => {
    const creator = firstAuthor(item);
    return creator ? templateCreator(creator) : null;
  },
  sortKey: (item) => {
    const creator = firstAuthor(item);
    return creator
      ? creatorSortKey(templateCreator(creator) as ProjectionJson)
      : null;
  },
  valueSortKey: creatorSortKey,
  filter: {
    type: "record",
    read: (item) => {
      const creator = firstAuthor(item);
      if (!creator) return null;
      const value = templateCreator(creator) as Record<string, string | null>;
      return {
        type: "record",
        identity: creator,
        read: (name) => value[name] ?? null,
      };
    },
  },
  navigation: {
    names: Object.keys((CREATOR_SHAPE as { keys: object }).keys),
    member: (name) =>
      name in (CREATOR_SHAPE as { keys: object }).keys
        ? {
            filterable: true,
            needs: CREATOR_NEEDS(),
            value: {
              type: "string",
              read: (value) => (isQueryRecord(value) ? value.read(name) : null),
            },
          }
        : undefined,
  },
};

const TAG_SHAPE: ValueShape = {
  kind: "object",
  keys: { name: STRING, type: STRING },
};

const tagsField: FieldDefinition = {
  shape: { kind: "list", element: TAG_SHAPE },
  needs: () => ({ relations: ["tags"] }),
  read: (item) =>
    (item.hydrated.tags ?? [])
      .toSorted((a, b) => compareStrings(a.name, b.name))
      .map((tag) => ({ name: tag.name, type: tagTypeToName(tag.type) })),
  filter: {
    type: "list",
    read: (item) =>
      (item.hydrated.tags ?? [])
        .map((tag) => tag.name)
        .toSorted(compareStrings),
  },
};

const collectionPaths = (item: QueryItem): string[] =>
  (item.hydrated.collections ?? [])
    .map((path) => path.join("/"))
    .toSorted(compareStrings);

const collectionsField: FieldDefinition = {
  shape: { kind: "list", element: STRING },
  needs: () => ({ relations: ["collections"] }),
  read: collectionPaths,
  filter: { type: "list", read: collectionPaths },
};

const attachmentsField: FieldDefinition = recordField({
  vocabulary: () => attachmentVocabulary(),
  list: true,
  rows: (item) => item.attachments ?? [],
  needs: (attachments) => ({ attachments }),
});

function lastRead(item: QueryItem): number | null {
  let latest: number | null = null;
  for (const attachment of item.attachments ?? []) {
    const value = attachment.scan.lastRead;
    if (value !== null && (latest === null || value > latest)) latest = value;
  }
  return latest;
}

const lastReadField: FieldDefinition = {
  shape: STRING,
  needs: () => ({ attachments: [{}] }),
  read: (item) => {
    const value = lastRead(item);
    return value === null
      ? null
      : Temporal.Instant.fromEpochMilliseconds(value);
  },
  sortKey: lastRead,
  filter: {
    type: "date",
    read: (item) => {
      const value = lastRead(item);
      return value === null
        ? null
        : timestamp(Temporal.Instant.fromEpochMilliseconds(value));
    },
  },
};

const LAST_ACTIVITY_SOURCES = [
  "read",
  "note",
  "annotation",
  "added",
  "use",
] as const;

export type LastActivitySource = (typeof LAST_ACTIVITY_SOURCES)[number];

function lastActivity(
  item: QueryItem,
): { readonly at: number; readonly source: LastActivitySource } | null {
  const signals: [number | null, LastActivitySource][] = [
    [lastRead(item), "read"],
  ];
  for (const note of item.notes ?? [])
    signals.push([note.scan.dateModified, "note"]);
  for (const annotation of item.annotations ?? [])
    signals.push([annotation.scan.dateModified, "annotation"]);
  signals.push([item.scan.dateAdded, "added"]);
  let latest: { at: number; source: LastActivitySource } | null = null;
  for (const [at, source] of signals)
    if (at !== null && (latest === null || at > latest.at))
      latest = { at, source };
  const use = item.lastUse;
  if (use !== undefined && (latest === null || use >= latest.at))
    latest = { at: use, source: "use" };
  return latest;
}

const lastActivityAt = (item: QueryItem): number | null =>
  lastActivity(item)?.at ?? null;

const LAST_ACTIVITY_NEEDS = (): FieldNeeds => ({
  attachments: [{}],
  notes: [{}],
  annotations: [{}],
});

const lastActivityField: FieldDefinition = {
  description:
    "Newest addition, Attachment read, child note or Annotation edit, or Use. Includes this device's Uses when the plugin supplies them.",
  shape: STRING,
  needs: LAST_ACTIVITY_NEEDS,
  read: (item) => {
    const value = lastActivityAt(item);
    return value === null
      ? null
      : Temporal.Instant.fromEpochMilliseconds(value);
  },
  sortKey: lastActivityAt,
  filter: {
    type: "date",
    read: (item) => {
      const value = lastActivityAt(item);
      return value === null
        ? null
        : timestamp(Temporal.Instant.fromEpochMilliseconds(value));
    },
  },
};

const lastActivitySourceField: FieldDefinition = {
  description:
    'The signal that set lastActivity: "read", "note", "annotation", "added", or "use" for a Use on this device.',
  shape: STRING,
  valueForms: LAST_ACTIVITY_SOURCES,
  needs: LAST_ACTIVITY_NEEDS,
  read: (item) => lastActivity(item)?.source ?? null,
  filter: {
    type: "string",
    read: (item) => lastActivity(item)?.source ?? null,
  },
};

export const ACTIVITY_FIELDS: ReadonlySet<string> = new Set([
  "lastActivity",
  "lastActivitySource",
]);

const FIELDS: ReadonlyMap<string, FieldDefinition> = new Map<
  string,
  FieldDefinition
>([
  ...Object.keys(FIELD_LABELS["en-US"]).map(
    (name) => [name, zoteroField(name)] as const,
  ),
  [
    "itemType",
    fromScan({
      read: (row) => row.itemType,
      sortKey: (row) => row.itemType,
      filter: { type: "string", read: (item) => item.scan.itemType },
    }),
  ],
  ["dateAdded", scanTimestamp("dateAdded")],
  ["dateModified", scanTimestamp("dateModified")],
  ["lastRead", lastReadField],
  ["lastActivity", lastActivityField],
  ["lastActivitySource", lastActivitySourceField],
  ["library", libraryField],
  ["key", keyField],
  ["indexedKey", indexedKeyField],
  ["custom", customField],
  ["creators", creatorsField],
  ["firstAuthor", firstAuthorField],
  ["tags", tagsField],
  ["collections", collectionsField],
  ["attachments", attachmentsField],
  [
    "annotations",
    recordField({
      vocabulary: () => annotationVocabulary(),
      list: true,
      rows: (item) => item.annotations ?? [],
      needs: (annotations) => ({ annotations }),
    }),
  ],
  [
    "notes",
    recordField({
      vocabulary: () => noteVocabulary(),
      list: true,
      rows: (item) => item.notes ?? [],
      needs: (notes) => ({ notes }),
    }),
  ],
]);

export const DEFAULT_FIELDS: readonly string[] = [
  "itemType",
  "title",
  "creators",
  "date",
  "dateModified",
];

export function fieldDefinition(name: string): FieldDefinition | undefined {
  return FIELDS.get(name);
}

export type FilterField<Item = QueryItem, Needs = FieldNeeds> =
  | {
      readonly filterable: true;
      readonly value: FilterValueDefinition<Item>;
      readonly needs: Needs;
      readonly customField?: string;
      readonly navigation?: FilterNavigation<Needs>;
    }
  | { readonly filterable: false };

export function filterField(name: string): FilterField | undefined {
  const definition = FIELDS.get(name);
  if (!definition) return undefined;
  return definitionFilter(definition);
}

export function customFilterValue(name: string): {
  value: FilterValueDefinition;
  needs: FieldNeeds;
} {
  return {
    value: {
      type: "string",
      read: (item) => item.hydrated.custom.get(name) ?? null,
    },
    needs: { custom: [name] },
  };
}

export const itemFilterRegistry: FilterRegistry<QueryItem, FieldNeeds> = {
  field: filterField,
  custom: customFilterValue,
};

export const BUILT_IN_NAMES: readonly string[] = [...FIELDS.keys()];

export function isStoredStringField(name: string): boolean {
  const definition = FIELDS.get(name);
  if (definition?.filter?.type !== "string") return false;
  const needs = definition.needs([]);
  return (
    needs.builtIn?.length === 1 &&
    needs.builtIn[0] === name &&
    !needs.custom &&
    !needs.relations
  );
}
