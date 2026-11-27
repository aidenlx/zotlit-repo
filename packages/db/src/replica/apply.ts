import type { ZoteroDatabase } from "#client/database.ts";
import type { CreatorFieldMode } from "#lib/zt-creator.ts";
import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";

import { logLibrary } from "@zotlit/shared/logging";
import {
  accessDateToSql,
  annotationColor,
  annotationValue,
  attachmentLastRead,
  attachmentPath,
  canonicalCharset,
  cleanNoteText,
  fieldText,
  hyphenateIsbnField,
  instantToSql,
  isoToSql,
  normalizeText,
  noteToTitle,
  singleLineFieldValue,
  strToMultipart,
  wrapNote,
} from "@zotlit/zotero-compat";
import { isMultipartDate } from "@zotlit/zotero-types/date";
import type {
  WebApiCollection,
  WebApiGroup,
  WebApiItem,
  WebApiItemData,
} from "@zotlit/zotero-types/web-api";

import type { ReplicaVocabulary } from "./vocabulary.ts";
import { readVocabulary } from "./vocabulary.ts";

import { USER_LIBRARY_ID } from "#lib/constants.ts";
import { annotationTypeFromName } from "#lib/zt-annot.ts";
import { linkModeFromName } from "#lib/zt-attach.ts";

const CATEGORY = ["zotlit", "db", "replica"] as const;

export type ReplicaLibraryRef =
  | { readonly type: "user" }
  | { readonly type: "group"; readonly groupID: number };

export function findLibraryID(
  db: ZoteroDatabase,
  library: ReplicaLibraryRef,
): number | undefined {
  if (library.type === "user") return USER_LIBRARY_ID;
  const row = db.get<{ libraryID: number }>(
    sql`select libraryID from groups where groupID = ${library.groupID}`,
  );
  return row === undefined ? undefined : Number(row.libraryID);
}

export function upsertGroupLibrary(
  db: ZoteroDatabase,
  group: WebApiGroup,
): number {
  const known = findLibraryID(db, { type: "group", groupID: group.id });
  const libraryID =
    known ??
    Number(
      db.get<{ libraryID: number }>(
        sql`insert into libraries (type, editable, filesEditable) values ('group', 0, 0) returning libraryID`,
      )!.libraryID,
    );
  db.run(
    sql`insert into groups (groupID, libraryID, name, description, version) values (${group.id}, ${libraryID}, ${group.data.name}, ${group.data.description ?? ""}, ${group.version})
      on conflict (groupID) do update set name = excluded.name, description = excluded.description, version = excluded.version`,
  );
  return libraryID;
}

export function findItemID(
  db: ZoteroDatabase,
  libraryID: number,
  key: string,
): number | undefined {
  const row = db.get<{ itemID: number }>(
    sql`select itemID from items where libraryID = ${libraryID} and key = ${key}`,
  );
  return row === undefined ? undefined : Number(row.itemID);
}

export function findItemKey(
  db: ZoteroDatabase,
  itemID: number,
): { libraryID: number; key: string } | undefined {
  const row = db.get<{ libraryID: number; key: string }>(
    sql`select libraryID, key from items where itemID = ${itemID}`,
  );
  return row === undefined
    ? undefined
    : { libraryID: Number(row.libraryID), key: row.key };
}

export function findCollectionID(
  db: ZoteroDatabase,
  libraryID: number,
  key: string,
): number | undefined {
  const row = db.get<{ collectionID: number }>(
    sql`select collectionID from collections where libraryID = ${libraryID} and key = ${key}`,
  );
  return row === undefined ? undefined : Number(row.collectionID);
}

export interface ReplicaChanges {
  readonly libraryID: number;
  readonly collections?: readonly WebApiCollection[];
  readonly items?: readonly WebApiItem[];
  readonly deleted?: {
    readonly collections?: readonly string[];
    readonly items?: readonly string[];
  };
}

export type ReplicaObjectType = "collection" | "item";

export interface ReplicaProblem {
  readonly objectType: ReplicaObjectType;
  readonly key: string;
  readonly reason:
    | "unknownItemType"
    | "unknownAnnotationType"
    | "unknownLinkMode"
    | "missingParent"
    | "missingCollection";
  readonly detail: string;
}

export interface ApplyResult {
  readonly applied: { collections: string[]; items: string[] };
  readonly removed: { collections: string[]; items: string[] };
  readonly deferred: ReplicaProblem[];
  readonly skipped: ReplicaProblem[];
}

export interface ReplicaOrphans {
  readonly valueIDs: Set<number>;
  readonly creatorIDs: Set<number>;
  readonly tagIDs: Set<number>;
}

export function newReplicaOrphans(): ReplicaOrphans {
  return { valueIDs: new Set(), creatorIDs: new Set(), tagIDs: new Set() };
}

export interface ApplyOptions {
  readonly currentYear?: number;
  readonly orphans?: ReplicaOrphans;
  readonly locale?: string;
  readonly timeZone?: string;
  readonly now?: Temporal.Instant;
}

export function applyRecords(
  db: ZoteroDatabase,
  changes: ReplicaChanges,
  {
    timeZone = Temporal.Now.timeZoneId(),
    now = Temporal.Now.instant(),
    currentYear = now.toZonedDateTimeISO(timeZone).year,
    orphans,
    locale,
  }: ApplyOptions = {},
): ApplyResult {
  const foreignKeys = db.get<{ foreign_keys: number }>(
    sql`pragma foreign_keys`,
  );
  if (Number(foreignKeys?.foreign_keys) !== 0) {
    throw new Error(
      "applyRecords needs a replica connection with foreign keys off; open it with pragma foreign_keys = off",
    );
  }
  const { libraryID } = changes;
  const context: Context = {
    db,
    libraryID,
    isGroup: libraryID !== USER_LIBRARY_ID,
    vocabulary: readVocabulary(db),
    currentYear,
    locale,
    timeZone,
    writtenAt: instantToSql(now),
    orphans: orphans ?? newReplicaOrphans(),
  };
  const result: ApplyResult = {
    applied: { collections: [], items: [] },
    removed: { collections: [], items: [] },
    deferred: [],
    skipped: [],
  };

  applyInParentOrder(
    {
      objectType: "collection",
      objects: changes.collections ?? [],
      apply: (collection) => applyCollection(context, collection),
      parentKey: (collection) =>
        collection.data.parentCollection === false
          ? undefined
          : collection.data.parentCollection,
    },
    result,
  );
  applyInParentOrder(
    {
      objectType: "item",
      objects: changes.items ?? [],
      apply: (item) => applyItem(context, item),
      parentKey: (item) => item.data.parentItem || undefined,
    },
    result,
  );

  for (const key of changes.deleted?.items ?? []) {
    if (removeItem(context, key)) result.removed.items.push(key);
  }
  for (const key of changes.deleted?.collections ?? []) {
    if (removeCollection(context, key)) result.removed.collections.push(key);
  }
  if (!orphans) purgeOrphans(db, context.orphans);
  return result;
}

interface Context {
  readonly db: ZoteroDatabase;
  readonly libraryID: number;
  readonly isGroup: boolean;
  readonly vocabulary: ReplicaVocabulary;
  readonly currentYear: number;
  readonly locale: string | undefined;
  readonly timeZone: string;
  readonly writtenAt: string;
  readonly orphans: ReplicaOrphans;
}

type Outcome = "applied" | Omit<ReplicaProblem, "objectType" | "key">;

function applyInParentOrder<T extends { readonly key: string }>(
  {
    objectType,
    objects,
    apply,
    parentKey,
  }: {
    objectType: ReplicaObjectType;
    objects: readonly T[];
    apply: (object: T) => Outcome;
    parentKey: (object: T) => string | undefined;
  },
  result: ApplyResult,
): void {
  const applied =
    objectType === "item" ? result.applied.items : result.applied.collections;
  let pending = [...objects];
  for (;;) {
    const pendingKeys = new Set(pending.map((object) => object.key));
    const waiting: T[] = [];
    const missing: { object: T; outcome: Exclude<Outcome, "applied"> }[] = [];
    for (const object of pending) {
      const outcome = apply(object);
      if (outcome === "applied") {
        applied.push(object.key);
      } else if (SKIPPED_REASONS.has(outcome.reason)) {
        result.skipped.push({ objectType, key: object.key, ...outcome });
      } else {
        missing.push({ object, outcome });
      }
    }
    for (const entry of missing) {
      const parent = parentKey(entry.object);
      if (
        entry.outcome.reason === "missingParent" &&
        parent &&
        pendingKeys.has(parent)
      ) {
        waiting.push(entry.object);
      } else {
        result.deferred.push({
          objectType,
          key: entry.object.key,
          ...entry.outcome,
        });
      }
    }
    if (waiting.length === 0 || waiting.length === pending.length) {
      for (const object of waiting) {
        result.deferred.push({
          objectType,
          key: object.key,
          reason: "missingParent",
          detail: `parent ${parentKey(object)} was not stored`,
        });
      }
      return;
    }
    pending = waiting;
  }
}

function applyCollection(
  { db, libraryID, writtenAt }: Context,
  { data }: WebApiCollection,
): Outcome {
  let parentID: number | null = null;
  if (data.parentCollection !== false) {
    const found = findCollectionID(db, libraryID, data.parentCollection);
    if (found === undefined) {
      return {
        reason: "missingParent",
        detail: `parent collection ${data.parentCollection} is not stored`,
      };
    }
    parentID = found;
  }
  const { collectionID } = db.get<{ collectionID: number }>(
    sql`insert into collections (collectionName, parentCollectionID, clientDateModified, libraryID, key, version, synced)
      values (${normalizeText(data.name)}, ${parentID}, ${writtenAt}, ${libraryID}, ${data.key}, ${data.version}, 1)
      on conflict (libraryID, key) do update set collectionName = excluded.collectionName,
        parentCollectionID = excluded.parentCollectionID, version = excluded.version, synced = 1
      returning collectionID`,
  )!;
  if (data.deleted) {
    db.run(
      sql`insert into deletedCollections (collectionID, dateDeleted) values (${collectionID}, ${writtenAt}) on conflict do nothing`,
    );
  } else {
    db.run(
      sql`delete from deletedCollections where collectionID = ${collectionID}`,
    );
  }
  return "applied";
}

const NON_FIELD_MEMBERS = new Set([
  "key",
  "version",
  "itemType",
  "note",
  "md5",
  "mtime",
  "collections",
  "parentItem",
  "deleted",
  "inPublications",
  "creators",
  "tags",
  "relations",
  "dateAdded",
  "dateModified",
  "lastRead",
  "linkMode",
  "filename",
  "contentType",
  "charset",
  "path",
  "annotationType",
  "annotationAuthorName",
  "annotationText",
  "annotationComment",
  "annotationColor",
  "annotationPageLabel",
  "annotationSortIndex",
  "annotationPosition",
]);

const SKIPPED_REASONS = new Set<ReplicaProblem["reason"]>([
  "unknownItemType",
  "unknownAnnotationType",
  "unknownLinkMode",
]);

function unknownValue(data: WebApiItemData): Outcome | undefined {
  const [reason, member, value] =
    data.itemType === "annotation" &&
    (data.annotationType === undefined ||
      annotationTypeFromName(data.annotationType) === undefined)
      ? ([
          "unknownAnnotationType",
          "annotation type",
          data.annotationType,
        ] as const)
      : data.itemType === "attachment" &&
          (data.linkMode === undefined ||
            linkModeFromName(data.linkMode) === undefined)
        ? (["unknownLinkMode", "link mode", data.linkMode] as const)
        : [];
  if (reason === undefined) return undefined;
  logLibrary({
    level: "warn",
    category: CATEGORY,
    message: "Skipped item {key}: unknown {member} {value}",
    properties: { key: data.key, member, value: String(value) },
  });
  return { reason, detail: `unknown ${member} ${String(value)}` };
}

function applyItem(context: Context, item: WebApiItem): Outcome {
  const { db, libraryID, vocabulary } = context;
  const { data } = item;
  const itemTypeID = vocabulary.itemTypeID(data.itemType);
  if (itemTypeID === undefined) {
    logLibrary({
      level: "warn",
      category: CATEGORY,
      message:
        "Skipped item {key}: the Zotero schema of this version has no item type {itemType}",
      properties: { key: data.key, itemType: data.itemType },
    });
    return {
      reason: "unknownItemType",
      detail: `unknown item type ${data.itemType}`,
    };
  }
  const invalid = unknownValue(data);
  if (invalid) return invalid;

  let parentItemID: number | null = null;
  if (data.parentItem) {
    const found = findItemID(db, libraryID, data.parentItem);
    if (found === undefined) {
      return {
        reason: "missingParent",
        detail: `parent item ${data.parentItem} is not stored`,
      };
    }
    parentItemID = found;
  }

  const collectionIDs: number[] = [];
  if (parentItemID === null) {
    for (const key of data.collections ?? []) {
      const found = findCollectionID(db, libraryID, key);
      if (found === undefined) {
        return {
          reason: "missingCollection",
          detail: `collection ${key} is not stored`,
        };
      }
      collectionIDs.push(found);
    }
  }

  const dateAdded = isoToSql(data.dateAdded, context.timeZone);
  const dateModified = isoToSql(data.dateModified, context.timeZone);
  const { itemID } = db.get<{ itemID: number }>(
    sql`insert into items (itemTypeID, dateAdded, dateModified, clientDateModified, libraryID, key, version, synced)
      values (${itemTypeID}, coalesce(${dateAdded}, ${context.writtenAt}), coalesce(${dateModified}, ${context.writtenAt}),
        coalesce(${dateModified}, ${context.writtenAt}), ${libraryID}, ${data.key}, ${data.version}, 1)
      on conflict (libraryID, key) do update set itemTypeID = excluded.itemTypeID, dateAdded = excluded.dateAdded,
        dateModified = excluded.dateModified, clientDateModified = excluded.clientDateModified,
        version = excluded.version, synced = 1
      returning itemID`,
  )!;

  writeFields(context, itemID, data);
  writeCreators(context, itemID, data);
  writeTags(context, itemID, data);
  writeRelations(context, itemID, data);
  writeCollections(context, itemID, collectionIDs);
  writeChildRows(context, { itemID, parentItemID }, data);

  if (data.deleted) {
    db.run(
      sql`insert into deletedItems (itemID, dateDeleted) values (${itemID}, ${context.writtenAt}) on conflict do nothing`,
    );
  } else {
    db.run(sql`delete from deletedItems where itemID = ${itemID}`);
  }
  if (context.isGroup) writeGroupItem(context, itemID, item);
  return "applied";
}

function logIgnoredField(key: string, field: string, reason: string): void {
  logLibrary({
    level: "warn",
    category: CATEGORY,
    message: "Ignored field {field} of item {key}: {reason}",
    properties: { key, field, reason },
  });
}

function writeFields(
  context: Context,
  itemID: number,
  data: WebApiItemData,
): void {
  const { db, vocabulary, orphans } = context;
  for (const row of db.all<{ valueID: number }>(
    sql`select valueID from itemData where itemID = ${itemID}`,
  )) {
    orphans.valueIDs.add(Number(row.valueID));
  }
  db.run(sql`delete from itemData where itemID = ${itemID}`);

  for (const [name, raw] of Object.entries(data)) {
    if (NON_FIELD_MEMBERS.has(name)) continue;
    let value: string;
    if (typeof raw === "number" && name === "accessDate") {
      logIgnoredField(data.key, name, `invalid access date ${raw}`);
      continue;
    } else if (typeof raw === "number") value = fieldText(raw);
    else if (typeof raw === "string" && name === "accessDate" && raw !== "") {
      const stored = accessDateToSql(raw, context.timeZone);
      if (stored === undefined) {
        logIgnoredField(data.key, name, `invalid access date ${raw}`);
        continue;
      }
      value = stored;
    } else if (typeof raw === "string") value = fieldText(raw);
    else {
      if (raw !== null && raw !== undefined && raw !== false) {
        logIgnoredField(data.key, name, `a ${typeof raw} is not a field value`);
      }
      continue;
    }
    if (value === "") continue;
    if (!vocabulary.isField(name)) {
      logIgnoredField(
        data.key,
        name,
        "the Zotero schema of this version has no such field",
      );
      continue;
    }
    const field = vocabulary.fieldForType(data.itemType, name);
    if (field === undefined) {
      logIgnoredField(
        data.key,
        name,
        `not a field of item type ${data.itemType}`,
      );
      continue;
    }
    value = singleLineFieldValue(field.name, value);
    if (field.name === "ISBN") value = hyphenateIsbnField(value);
    if (vocabulary.isDateField(field.name) && !isMultipartDate(value)) {
      value = strToMultipart(value, context);
    }
    const valueID = internValue(db, value);
    orphans.valueIDs.add(valueID);
    db.run(
      sql`insert into itemData (itemID, fieldID, valueID) values (${itemID}, ${field.id}, ${valueID})
        on conflict (itemID, fieldID) do update set valueID = excluded.valueID`,
    );
  }
}

function internValue(db: ZoteroDatabase, value: string): number {
  const found = db.get<{ valueID: number }>(
    sql`select valueID from itemDataValues where value = ${value}`,
  );
  if (found) return Number(found.valueID);
  return Number(
    db.get<{ valueID: number }>(
      sql`insert into itemDataValues (value) values (${value}) returning valueID`,
    )!.valueID,
  );
}

function writeCreators(
  context: Context,
  itemID: number,
  data: WebApiItemData,
): void {
  const { db, vocabulary, orphans } = context;
  for (const row of db.all<{ creatorID: number }>(
    sql`select creatorID from itemCreators where itemID = ${itemID}`,
  )) {
    orphans.creatorIDs.add(Number(row.creatorID));
  }
  db.run(sql`delete from itemCreators where itemID = ${itemID}`);
  let orderIndex = 0;
  for (const [position, creator] of (data.creators ?? []).entries()) {
    let firstName = "";
    let lastName: string;
    let fieldMode: CreatorFieldMode = 0;
    if ("name" in creator) {
      lastName = normalizeText(creator.name);
      fieldMode = 1;
    } else {
      firstName = normalizeText(creator.firstName ?? "");
      lastName = normalizeText(creator.lastName ?? "");
    }
    const creatorType = vocabulary.creatorTypeForItem(
      data.itemType,
      creator.creatorType,
    );
    if (creatorType === undefined) {
      logLibrary({
        level: "warn",
        category: CATEGORY,
        message: "Ignored creator {position} of item {key}: {reason}",
        properties: {
          key: data.key,
          position,
          reason: `item type ${data.itemType} has no creator types`,
        },
      });
      continue;
    }
    if (!creatorType.valid) {
      logLibrary({
        level: "warn",
        category: CATEGORY,
        message:
          "Creator type {creatorType} is not valid for item type {itemType} of item {key}; the primary creator type is stored",
        properties: {
          key: data.key,
          creatorType: creator.creatorType,
          itemType: data.itemType,
        },
      });
    }
    const creatorID = internCreator(db, { firstName, lastName, fieldMode });
    db.run(
      sql`insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex) values (${itemID}, ${creatorID}, ${creatorType.id}, ${orderIndex})`,
    );
    orderIndex += 1;
  }
}

function internCreator(
  db: ZoteroDatabase,
  {
    firstName,
    lastName,
    fieldMode,
  }: { firstName: string; lastName: string; fieldMode: CreatorFieldMode },
): number {
  const found = db.get<{ creatorID: number }>(
    sql`select creatorID from creators where firstName = ${firstName} and lastName = ${lastName} and fieldMode = ${fieldMode}`,
  );
  if (found) return Number(found.creatorID);
  return Number(
    db.get<{ creatorID: number }>(
      sql`insert into creators (firstName, lastName, fieldMode) values (${firstName}, ${lastName}, ${fieldMode}) returning creatorID`,
    )!.creatorID,
  );
}

function writeTags(
  context: Context,
  itemID: number,
  data: WebApiItemData,
): void {
  const { db, orphans } = context;
  for (const row of db.all<{ tagID: number }>(
    sql`select tagID from itemTags where itemID = ${itemID}`,
  )) {
    orphans.tagIDs.add(Number(row.tagID));
  }
  db.run(sql`delete from itemTags where itemID = ${itemID}`);
  for (const tag of data.tags ?? []) {
    const name = normalizeText(String(tag.tag));
    if (name === "") continue;
    const type = tag.type ? 1 : 0;
    db.run(
      sql`insert into itemTags (itemID, tagID, type) values (${itemID}, ${internTag(db, name)}, ${type})
        on conflict (itemID, tagID) do update set type = excluded.type`,
    );
  }
}

function internTag(db: ZoteroDatabase, name: string): number {
  const found = db.get<{ tagID: number }>(
    sql`select tagID from tags where name = ${name}`,
  );
  if (found) return Number(found.tagID);
  return Number(
    db.get<{ tagID: number }>(
      sql`insert into tags (name) values (${name}) returning tagID`,
    )!.tagID,
  );
}

function writeRelations(
  context: Context,
  itemID: number,
  data: WebApiItemData,
): void {
  const { db } = context;
  db.run(sql`delete from itemRelations where itemID = ${itemID}`);
  for (const [predicate, objects] of Object.entries(data.relations ?? {})) {
    const predicateID = internPredicate(db, predicate);
    for (const object of typeof objects === "string" ? [objects] : objects) {
      db.run(
        sql`insert into itemRelations (itemID, predicateID, object) values (${itemID}, ${predicateID}, ${object}) on conflict do nothing`,
      );
    }
  }
}

function internPredicate(db: ZoteroDatabase, predicate: string): number {
  const found = db.get<{ predicateID: number }>(
    sql`select predicateID from relationPredicates where predicate = ${predicate}`,
  );
  if (found) return Number(found.predicateID);
  return Number(
    db.get<{ predicateID: number }>(
      sql`insert into relationPredicates (predicate) values (${predicate}) returning predicateID`,
    )!.predicateID,
  );
}

function writeCollections(
  { db }: Context,
  itemID: number,
  collectionIDs: readonly number[],
): void {
  const ids = JSON.stringify(collectionIDs);
  db.run(
    sql`delete from collectionItems where itemID = ${itemID} and collectionID not in (select value from json_each(${ids}))`,
  );
  for (const collectionID of collectionIDs) {
    db.run(
      sql`insert into collectionItems (collectionID, itemID, orderIndex)
        values (${collectionID}, ${itemID}, (select ifnull(max(orderIndex) + 1, 0) from collectionItems where collectionID = ${collectionID}))
        on conflict do nothing`,
    );
  }
}

interface ChildRow {
  readonly itemID: number;
  readonly parentItemID: number | null;
}

function writeChildRows(
  context: Context,
  { itemID, parentItemID }: ChildRow,
  data: WebApiItemData,
): void {
  const { db } = context;
  const isNote = data.itemType === "note";
  const isAttachment = data.itemType === "attachment";
  const isAnnotation = data.itemType === "annotation";

  if (!isAttachment)
    db.run(sql`delete from itemAttachments where itemID = ${itemID}`);
  if (!isAnnotation)
    db.run(sql`delete from itemAnnotations where itemID = ${itemID}`);

  if ((isNote || isAttachment) && data.linkMode !== "embedded_image") {
    const text = cleanNoteText(typeof data.note === "string" ? data.note : "");
    const note = wrapNote(text);
    const title = noteToTitle(text);
    const noteParent = isNote ? parentItemID : null;
    if (isNote || text !== "") {
      db.run(
        sql`insert into itemNotes (itemID, parentItemID, note, title) values (${itemID}, ${noteParent}, ${note}, ${title})
          on conflict (itemID) do update set parentItemID = excluded.parentItemID, note = excluded.note, title = excluded.title`,
      );
    } else {
      db.run(
        sql`update itemNotes set parentItemID = ${noteParent}, note = ${note}, title = ${title} where itemID = ${itemID}`,
      );
    }
  } else {
    db.run(sql`delete from itemNotes where itemID = ${itemID}`);
  }

  if (isAttachment) writeAttachment(context, { itemID, parentItemID }, data);
  if (isAnnotation) writeAnnotation(context, { itemID, parentItemID }, data);
}

function writeAttachment(
  { db, isGroup }: Context,
  { itemID, parentItemID }: ChildRow,
  data: WebApiItemData,
): void {
  const linkMode = linkModeFromName(data.linkMode!)!;
  const path = attachmentPath(data.linkMode, data);
  const lastRead = isGroup ? null : attachmentLastRead(data.lastRead);
  db.run(
    sql`insert into itemAttachments (itemID, parentItemID, linkMode, contentType, charsetID, path, syncState, storageModTime, storageHash, lastProcessedModificationTime, lastRead)
      values (${itemID}, ${parentItemID}, ${linkMode}, ${data.contentType || null},
        (select charsetID from charsets where charset = ${canonicalCharset(data.charset)}), ${path}, 0, null, null, null, ${lastRead})
      on conflict (itemID) do update set parentItemID = excluded.parentItemID, linkMode = excluded.linkMode,
        contentType = excluded.contentType, charsetID = excluded.charsetID, path = excluded.path,
        lastRead = ${isGroup ? sql`itemAttachments.lastRead` : sql`excluded.lastRead`}`,
  );
}

function writeAnnotation(
  { db }: Context,
  { itemID, parentItemID }: ChildRow,
  data: WebApiItemData,
): void {
  const type = annotationTypeFromName(data.annotationType!)!;
  const clean = annotationValue;
  const hasText =
    data.annotationType === "highlight" || data.annotationType === "underline";
  db.run(
    sql`insert into itemAnnotations (itemID, parentItemID, type, authorName, text, comment, color, pageLabel, sortIndex, position, isExternal)
      values (${itemID}, ${parentItemID}, ${type}, ${clean(data.annotationAuthorName)},
        ${hasText ? clean(data.annotationText) : null}, ${clean(data.annotationComment)},
        ${annotationColor(data.annotationColor)}, ${clean(data.annotationPageLabel)},
        ${clean(data.annotationSortIndex) ?? ""}, ${typeof data.annotationPosition === "string" ? data.annotationPosition : ""}, 0)
      on conflict (itemID) do update set parentItemID = excluded.parentItemID, type = excluded.type,
        authorName = excluded.authorName, text = excluded.text, comment = excluded.comment, color = excluded.color,
        pageLabel = excluded.pageLabel, sortIndex = excluded.sortIndex, position = excluded.position`,
  );
}

function writeGroupItem(
  { db }: Context,
  itemID: number,
  item: WebApiItem,
): void {
  const userID = (
    role: "createdByUser" | "lastModifiedByUser",
  ): number | null => {
    const user = item.meta?.[role];
    if (!user) return null;
    db.run(
      sql`insert into users (userID, name) values (${user.id}, ${user.name || user.username})
        on conflict (userID) do update set name = excluded.name`,
    );
    return user.id;
  };
  const createdBy = userID("createdByUser");
  const modifiedBy = userID("lastModifiedByUser");
  db.run(
    sql`insert into groupItems (itemID, createdByUserID, lastModifiedByUserID) values (${itemID}, ${createdBy}, ${modifiedBy})
      on conflict (itemID) do update set createdByUserID = coalesce(excluded.createdByUserID, createdByUserID),
        lastModifiedByUserID = coalesce(excluded.lastModifiedByUserID, lastModifiedByUserID)`,
  );
}

function inList(ids: readonly number[]): SQL {
  return sql`(select value from json_each(${JSON.stringify(ids)}))`;
}

function removeItem(context: Context, key: string): boolean {
  const { db, libraryID, orphans } = context;
  const itemID = findItemID(db, libraryID, key);
  if (itemID === undefined) return false;
  const ids = db
    .all<{ itemID: number }>(
      sql`with recursive doomed(itemID) as (
        select ${itemID}
        union select child.itemID from itemAttachments as child join doomed on child.parentItemID = doomed.itemID
        union select child.itemID from itemNotes as child join doomed on child.parentItemID = doomed.itemID
        union select child.itemID from itemAnnotations as child join doomed on child.parentItemID = doomed.itemID
      ) select itemID from doomed`,
    )
    .map((row) => Number(row.itemID));
  const list = inList(ids);
  for (const row of db.all<{ valueID: number }>(
    sql`select valueID from itemData where itemID in ${list}`,
  )) {
    orphans.valueIDs.add(Number(row.valueID));
  }
  for (const row of db.all<{ creatorID: number }>(
    sql`select creatorID from itemCreators where itemID in ${list}`,
  )) {
    orphans.creatorIDs.add(Number(row.creatorID));
  }
  for (const row of db.all<{ tagID: number }>(
    sql`select tagID from itemTags where itemID in ${list}`,
  )) {
    orphans.tagIDs.add(Number(row.tagID));
  }
  for (const table of [
    "itemData",
    "itemCreators",
    "itemTags",
    "itemRelations",
    "collectionItems",
    "deletedItems",
    "groupItems",
    "itemAnnotations",
    "itemNotes",
    "itemAttachments",
    "items",
  ]) {
    db.run(sql`delete from ${sql.identifier(table)} where itemID in ${list}`);
  }
  return true;
}

function removeCollection({ db, libraryID }: Context, key: string): boolean {
  const collectionID = findCollectionID(db, libraryID, key);
  if (collectionID === undefined) return false;
  const ids = db
    .all<{ collectionID: number }>(
      sql`with recursive doomed(collectionID) as (
        select ${collectionID}
        union
        select child.collectionID from collections as child join doomed on child.parentCollectionID = doomed.collectionID
      ) select collectionID from doomed`,
    )
    .map((row) => Number(row.collectionID));
  const list = inList(ids);
  db.run(sql`delete from collectionItems where collectionID in ${list}`);
  db.run(sql`delete from deletedCollections where collectionID in ${list}`);
  db.run(sql`delete from collections where collectionID in ${list}`);
  return true;
}

export function purgeOrphans(
  db: ZoteroDatabase,
  orphans: ReplicaOrphans,
): void {
  if (orphans.valueIDs.size > 0) {
    db.run(
      sql`delete from itemDataValues where valueID in (select j.value from json_each(${JSON.stringify([...orphans.valueIDs])}) as j
        where not exists (select 1 from itemData as used where used.valueID = j.value))`,
    );
  }
  if (orphans.creatorIDs.size > 0) {
    db.run(
      sql`delete from creators where creatorID in ${inList([...orphans.creatorIDs])}
        and creatorID not in (select creatorID from itemCreators)`,
    );
  }
  if (orphans.tagIDs.size > 0) {
    db.run(
      sql`delete from tags where tagID in (select j.value from json_each(${JSON.stringify([...orphans.tagIDs])}) as j
        where not exists (select 1 from itemTags as used where used.tagID = j.value))`,
    );
  }
}
