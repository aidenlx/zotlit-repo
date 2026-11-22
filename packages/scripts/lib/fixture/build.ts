import { readFileSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { formatAnnotationSubpath, USER_LIBRARY_ID } from "@zotlit/db";
import type { FrontmatterField } from "@zotlit/templates/constants";
import {
  DEFAULT_ANNOTATION_ETA,
  DEFAULT_ANNOTATION_LIQUID,
  DEFAULT_CITATION_BRANCHES,
  formatPlainTemplateDocument,
} from "@zotlit/templates/facade";
import { formatIndexedKey } from "@zotlit/zotero-types/keys";

import { holdsZotLit } from "./layout.ts";
import type { FixtureLayout } from "./layout.ts";
import {
  BETTER_BIBTEX_PREFS,
  OBSIDIAN_PROTOCOL_PREFS,
  QUIET_FIRST_RUN_PREFS,
} from "./paired-zotero.ts";
import {
  assertSchemaVersions,
  writePristineDatabase,
  writePristineStyles,
} from "./pristine.ts";
import {
  ASSET_DIR,
  assertSeededCitationKeys,
  ATTACHMENTS,
  BUILD_TIMESTAMP,
  CITATION_DOCUMENT_EDIT,
  COLLECTIONS,
  createStressItems,
  createStressLibraryCorpus,
  DEFAULT_SCOPE_CASE,
  DEFAULT_VAULT_CASE,
  DEMO_ATTACHMENTS,
  DEMO_ITEMS,
  DEMO_PROFILE_DOCUMENT,
  EXCERPT_RENDERING_PDFS,
  EXCERPT_RENDERING_VAULT_DIR,
  PDF_READER_PDFS,
  PDF_READER_VAULT_DIR,
  findScopeCase,
  findVaultCase,
  FIXTURE_ITEM_FIELDS,
  FIXTURE_ITEM_TYPES,
  GRAPH_ITEMS,
  GRAPH_LITERATURE_NOTE_BODIES,
  GRAPH_VIEW_OPTIONS,
  holdsDemoPapers,
  INSTALLED_STYLES,
  ITEMS,
  LITERATURE_NOTE_DOCUMENTS,
  LITERATURE_NOTE_PROFILES,
  LIBRARIES,
  LIBRARY_SCOPE_SETTING_KEY,
  NOTES,
  SELECTION_LINK_PDFS,
  SELECTION_LINK_VAULT_DIR,
  SHARED_PARTIAL_DOCUMENTS,
  UPGRADER_FRONTMATTER_FIELDS,
  UPGRADER_LEGACY_TEMPLATES,
  UPGRADER_PLUGIN_VERSION,
  UPGRADER_SETTINGS_VERSION,
  vaultCaseZoteroData,
  VAULT_PROPERTY_TYPES,
} from "./spec.ts";
import type {
  FixtureAnnotation,
  FixtureAsset,
  FixtureAttachment,
  FixtureCreator,
  FixtureItem,
  FixtureItemField,
  FixtureLegacyTemplate,
  FixtureLegacyTemplateOrigin,
  FixtureNote,
  FixtureTemplateEdit,
  FixtureVaultCase,
  FixtureVaultValue,
  FixtureZoteroData,
  PersistedLibraryScope,
} from "./spec.ts";

export {
  ANNOTATIONS,
  ASSET_DIR,
  ATTACHMENTS,
  BUILD_TIMESTAMP,
  COLLECTIONS,
  createStressItems,
  createStressLibraryCorpus,
  DEFAULT_SCOPE_CASE,
  DEFAULT_VAULT_CASE,
  DEMO_ANNOTATIONS,
  DEMO_ATTACHMENTS,
  DEMO_ITEMS,
  DEMO_PAPERS_DIR,
  DEMO_PROFILE_DOCUMENT,
  DOCS_ANNOTATIONS,
  DOCS_ATTACHMENTS,
  DOCS_COLLECTIONS,
  DOCS_ITEMS,
  DOCS_NOTES,
  EXCERPT_RENDERING_CASES,
  EXCERPT_RENDERING_PDFS,
  EXCERPT_RENDERING_VAULT_DIR,
  findScopeCase,
  findVaultCase,
  FIXTURE_ITEM_TYPES,
  FIXTURE_PARTIAL_NAME,
  GRAPH_ITEMS,
  GRAPH_LITERATURE_NOTE_BODIES,
  GRAPH_RESEARCH_FOLDERS,
  GRAPH_VIEW_OPTIONS,
  INSTALLED_STYLES,
  ITEMS,
  LITERATURE_NOTE_DOCUMENTS,
  LITERATURE_NOTE_PROFILES,
  LIBRARIES,
  LIBRARY_SCOPE_SETTING_KEY,
  NOTES,
  PARITY_PDFS,
  PERSONAL_SELECTOR,
  SCOPE_CASES,
  SEEDED_CITATION_KEYS,
  seededCitationKeyDrift,
  UNAVAILABLE_GROUP_IDS,
  UPGRADER_FRONTMATTER_FIELDS,
  UPGRADER_LEGACY_PARTIAL_NAME,
  UPGRADER_LEGACY_TEMPLATES,
  UPGRADER_PLUGIN_VERSION,
  UPGRADER_SETTINGS_VERSION,
  VAULT_CASES,
} from "./spec.ts";
export {
  DEFAULT_STRESS_ITEM_COUNT,
  STRESS_GROUP_LIBRARY,
  STRESS_GROUP_LIBRARY_ITEM_COUNT_CONSTRAINT,
  STRESS_GROUP_LIBRARY_MIN_ITEM_COUNT,
  STRESS_ITEM_COUNT_CONSTRAINT,
  STRESS_LIBRARY_ITEM_COUNT_CONSTRAINT,
  STRESS_LIBRARY_MIN_ITEM_COUNT,
  STRESS_LIBRARY_TIERS,
  STRESS_LIBRARY_VALUES,
} from "./spec.ts";
export type {
  FixtureAnnotation,
  FixtureAnnotationAsset,
  FixtureAsset,
  FixtureAttachment,
  FixtureCollection,
  FixtureCreator,
  FixtureExcerptCase,
  FixtureExcerptPdf,
  FixtureItem,
  FixtureLibrary,
  FixtureNote,
  FixtureParityBranch,
  FixtureParityPdf,
  FixtureScopeCase,
  FixtureStyle,
  FixtureVaultCase,
  LibrarySelector,
  PersistedLibraryScope,
  StressLibraryCorpus,
} from "./spec.ts";
export { getFixtureLayout, getFixtureRoot } from "./layout.ts";
export type { FixtureLayout } from "./layout.ts";
export {
  clearPairedRunState,
  livePairedZotero,
  pairedRunStatePath,
  readPairedRunState,
  writePairedRunState,
} from "./run-state.ts";
export type { PairedRunState } from "./run-state.ts";

export interface FixturePlugin {
  id: string;
  bundleDir: string;
}

export interface BuildOptions {
  scopeCase?: string;
  vaultCase?: string;
  stressItemCount?: number;
  stressSparseLibraryID?: number;
  stressLibraryItemCount?: number;
  stressGroupLibraryItemCount?: number;
  plugins?: readonly FixturePlugin[];
  installed?: readonly FixturePlugin[];
  liveUpdatePort?: number;
  zoteroHttpPort?: number;
  localApi?: boolean;
  grantLocalApiWrites?: boolean;
  upgraderFields?: readonly FrontmatterField[];
  linkedAttachmentVaultDir?: string;
}

export const LIVE_UPDATE_HOSTNAME = "127.0.0.1";

export async function buildFixture(
  layout: FixtureLayout,
  options: BuildOptions = {},
): Promise<void> {
  if (
    options.stressItemCount !== undefined &&
    options.stressLibraryItemCount !== undefined
  ) {
    throw new Error(
      "a build takes one Stress Build: an additive Item count or a My Library Item count",
    );
  }
  const vaultCase = findVaultCase(options.vaultCase ?? DEFAULT_VAULT_CASE);
  if (
    options.stressLibraryItemCount !== undefined &&
    vaultCase.ownItems !== undefined
  ) {
    throw new Error(
      `the "${vaultCase.id}" vault case holds only its own Items: build the Stress Build of My Library with another vault case`,
    );
  }
  if (
    options.stressGroupLibraryItemCount !== undefined &&
    options.stressLibraryItemCount === undefined
  ) {
    throw new Error(
      "a Stress Build fills the group Library together with My Library: give both Item counts",
    );
  }
  const stressLibrary =
    options.stressLibraryItemCount === undefined
      ? undefined
      : createStressLibraryCorpus(
          options.stressLibraryItemCount,
          options.stressGroupLibraryItemCount,
        );
  const items =
    options.stressItemCount !== undefined
      ? [
          ...ITEMS,
          ...createStressItems(options.stressItemCount, {
            sparseLibraryID: options.stressSparseLibraryID,
          }),
        ]
      : stressLibrary
        ? [...ITEMS, ...stressLibrary.items]
        : ITEMS;

  assertSeededCitationKeys(items);
  const baseData = vaultCaseZoteroData(
    vaultCase.id,
    items,
    stressLibrary ? [...COLLECTIONS, ...stressLibrary.collections] : undefined,
  );

  const data = stressLibrary
    ? {
        ...baseData,
        attachments: [...baseData.attachments, ...stressLibrary.attachments],
        annotations: [...baseData.annotations, ...stressLibrary.annotations],
      }
    : baseData;

  await rm(layout.root, { recursive: true, force: true });
  await mkdir(layout.dataDir, { recursive: true });
  await mkdir(layout.profileDir, { recursive: true });
  await writeDatabase(layout, data, options);
  await writePristineStyles(layout.dataDir);
  await writeInstalledStyles(layout);
  const demo = holdsDemoPapers(vaultCase.id);
  await writeAttachmentFiles(layout, data.attachments, demo);
  await writeAnnotationCacheFiles(layout, data.annotations);
  await writePrefs(layout, options);
  await writeLocalApiAuthorizations(layout, options);
  await writeVault(layout, options);
  if (vaultCase.ownItems === undefined) {
    await writeExcerptAcceptanceFiles(layout);
    await writeVaultAssets(layout, PDF_READER_VAULT_DIR, PDF_READER_PDFS);
    await writeVaultAssets(
      layout,
      SELECTION_LINK_VAULT_DIR,
      SELECTION_LINK_PDFS,
    );
  }
}

export async function selectScopeCase(
  layout: FixtureLayout,
  id: string,
): Promise<void> {
  const raw = await readFile(layout.pluginDataPath, "utf-8").catch(() => {
    throw new Error(`no Fixture Vault at ${layout.vaultDir}. Build it first.`);
  });
  const data = JSON.parse(raw) as Record<string, unknown>;
  data[LIBRARY_SCOPE_SETTING_KEY] = findScopeCase(id).scope;
  await writeJson(layout.pluginDataPath, data);
}

export async function discardFixture(layout: FixtureLayout): Promise<void> {
  await rm(layout.root, { recursive: true, force: true });
}

type Row = readonly SQLInputValue[];

const ATTACHMENT_LINK_MODES = {
  imported_file: 0,
  imported_url: 1,
  linked_file: 2,
  linked_url: 3,
} as const;

const VAULT_PAGES_DIR = join(import.meta.dirname, "vault-pages");
const DEMO_PAGES_DIR = join(import.meta.dirname, "demo-pages");
const GRAPH_PAGES_DIR = join(import.meta.dirname, "graph-pages");
const VAULT_PLUGINS_DIR = join(import.meta.dirname, "vault-plugins");

function attachmentDatabasePath(
  attachment: FixtureAttachment,
  layout: FixtureLayout,
  linkedAttachmentVaultDir = layout.vaultDir,
): string | null {
  switch (attachment.linkMode) {
    case "imported_file":
    case "imported_url":
      return `storage:${attachment.path}`;
    case "linked_file":
      return join(
        attachment.fileRoot === "vault"
          ? linkedAttachmentVaultDir
          : layout.linkedFilesDir,
        attachment.path,
      );
    case "linked_url":
      return null;
  }
}

function attachmentFilePath(
  attachment: FixtureAttachment,
  layout: FixtureLayout,
  linkedAttachmentVaultDir = layout.vaultDir,
): string | null {
  switch (attachment.linkMode) {
    case "imported_file":
    case "imported_url":
      return join(layout.dataDir, "storage", attachment.key, attachment.path);
    case "linked_file":
      return join(
        attachment.fileRoot === "vault"
          ? linkedAttachmentVaultDir
          : layout.linkedFilesDir,
        attachment.path,
      );
    case "linked_url":
      return null;
  }
}

async function writeAttachmentFiles(
  layout: FixtureLayout,
  attachments: readonly FixtureAttachment[],
  demo: boolean,
): Promise<void> {
  for (const attachment of attachments) {
    if (attachment.sourceAsset === null) continue;
    if (
      attachment.linkMode === "linked_file" &&
      attachment.fileRoot === "vault" &&
      DEMO_ATTACHMENTS.includes(attachment) !== demo
    )
      continue;
    const destination = attachmentFilePath(attachment, layout)!;
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(ASSET_DIR, attachment.sourceAsset), destination);
  }
}

async function writeExcerptAcceptanceFiles(
  layout: FixtureLayout,
): Promise<void> {
  const destination = join(layout.vaultDir, EXCERPT_RENDERING_VAULT_DIR);
  await mkdir(destination, { recursive: true });
  for (const { asset } of EXCERPT_RENDERING_PDFS)
    await cp(
      join(ASSET_DIR, asset),
      join(destination, asset.split("/").at(-1)!),
    );
}

async function writeVaultAssets(
  layout: FixtureLayout,
  directory: string,
  assets: readonly FixtureAsset[],
): Promise<void> {
  const destination = join(layout.vaultDir, directory);
  await mkdir(destination, { recursive: true });
  for (const asset of assets)
    await cp(
      join(ASSET_DIR, asset),
      join(destination, asset.split("/").at(-1)!),
    );
}

async function writeAnnotationCacheFiles(
  layout: FixtureLayout,
  annotations: readonly FixtureAnnotation[],
): Promise<void> {
  for (const annotation of annotations) {
    if (annotation.cacheImageAsset === null) continue;
    const groupID = LIBRARIES.find(
      (library) => library.libraryID === annotation.libraryID,
    )!.groupID;
    const libraryPath =
      groupID === null ? "library" : join("groups", String(groupID));
    const destination = join(
      layout.dataDir,
      "cache",
      libraryPath,
      `${annotation.key}.png`,
    );
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(ASSET_DIR, annotation.cacheImageAsset), destination);
  }
}

async function writeInstalledStyles(layout: FixtureLayout): Promise<void> {
  const stylesDir = join(layout.dataDir, "styles");
  await mkdir(stylesDir, { recursive: true });
  for (const style of INSTALLED_STYLES) {
    await cp(
      join(ASSET_DIR, "styles", style.file),
      join(stylesDir, style.file),
    );
  }
}

async function writeDatabase(
  layout: FixtureLayout,
  data: FixtureZoteroData,
  options: BuildOptions,
): Promise<void> {
  await writePristineDatabase(layout.databasePath);
  using db = new DatabaseSync(layout.databasePath);
  db.function(
    "current_timestamp",
    { deterministic: true },
    () => BUILD_TIMESTAMP,
  );
  assertSchemaVersions(db);
  db.exec("begin");
  try {
    seedDatabase(db, readSchemaIDs(db), {
      layout,
      data,
      linkedAttachmentVaultDir: options.linkedAttachmentVaultDir,
    });
    if (options.localApi) {
      db.prepare(
        "replace into settings values ('localAPI', 'serverID', ?)",
      ).run(FIXTURE_LOCAL_API_SERVER_ID);
    }
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}

interface SchemaIDs {
  itemTypes: Record<
    FixtureItem["itemType"] | "annotation" | "attachment" | "note",
    number
  >;
  fields: Record<
    "title" | "citationKey" | "date" | "url" | "accessDate",
    number
  >;
  roleFields: Record<FixtureItem["itemType"], VenueRoleFields>;
  itemFields: Record<
    FixtureItem["itemType"],
    Partial<Record<FixtureItemField, number>>
  >;
  charsets: Record<"utf-8", number>;
  creatorTypes: Record<FixtureCreator["creatorType"], number>;
}

interface VenueRoleFields {
  container: number | null;
  publisher: number | null;
}

function readSchemaIDs(db: DatabaseSync): SchemaIDs {
  const lookup = <T extends string>(
    sql: string,
    column: string,
    names: readonly T[],
  ): Record<T, number> => {
    const statement = db.prepare(sql);
    return Object.fromEntries(
      names.map((name) => {
        const row = statement.get(name) as Record<string, number> | undefined;
        const id = row?.[column];
        if (id === undefined) {
          throw new Error(
            `the pristine template carries no "${name}" in its global schema.`,
          );
        }
        return [name, id];
      }),
    ) as Record<T, number>;
  };

  const itemTypes = lookup(
    "select itemTypeID from itemTypesCombined where typeName = ?",
    "itemTypeID",
    [...FIXTURE_ITEM_TYPES, "note", "attachment", "annotation"],
  );

  return {
    itemTypes,
    fields: lookup(
      "select fieldID from fieldsCombined where fieldName = ?",
      "fieldID",
      ["title", "citationKey", "date", "url", "accessDate"],
    ),
    roleFields: Object.fromEntries(
      FIXTURE_ITEM_TYPES.map((itemType) => [
        itemType,
        readVenueRoleFields(db, itemTypes[itemType]),
      ]),
    ) as Record<FixtureItem["itemType"], VenueRoleFields>,
    itemFields: Object.fromEntries(
      FIXTURE_ITEM_TYPES.map((itemType) => [
        itemType,
        readItemFields(db, itemTypes[itemType]),
      ]),
    ) as SchemaIDs["itemFields"],
    charsets: lookup(
      "select charsetID from charsets where charset = ?",
      "charsetID",
      ["utf-8"],
    ),
    creatorTypes: lookup(
      "select creatorTypeID from creatorTypes where creatorType = ?",
      "creatorTypeID",
      ["author", "contributor", "editor"],
    ),
  };
}

function readVenueRoleFields(
  db: DatabaseSync,
  itemTypeID: number,
): VenueRoleFields {
  const aliased = db.prepare(
    "select fieldID from baseFieldMappingsCombined where itemTypeID = ?" +
      " and baseFieldID = (select fieldID from fieldsCombined where fieldName = ?)",
  );
  const native = db.prepare(
    "select itf.fieldID as fieldID from itemTypeFieldsCombined itf" +
      " join fieldsCombined f on f.fieldID = itf.fieldID" +
      " where itf.itemTypeID = ? and f.fieldName = ?",
  );
  const roleFieldID = (baseFieldName: string): number | null => {
    const row = (aliased.get(itemTypeID, baseFieldName) ??
      native.get(itemTypeID, baseFieldName)) as { fieldID: number } | undefined;
    return row?.fieldID ?? null;
  };
  return {
    container: roleFieldID("publicationTitle"),
    publisher: roleFieldID("publisher"),
  };
}

function readItemFields(
  db: DatabaseSync,
  itemTypeID: number,
): Partial<Record<FixtureItemField, number>> {
  const native = db.prepare(
    "select itf.fieldID as fieldID from itemTypeFieldsCombined itf" +
      " join fieldsCombined f on f.fieldID = itf.fieldID" +
      " where itf.itemTypeID = ? and f.fieldName = ?",
  );
  return Object.fromEntries(
    FIXTURE_ITEM_FIELDS.flatMap((fieldName) => {
      const row = native.get(itemTypeID, fieldName) as
        | { fieldID: number }
        | undefined;
      return row === undefined ? [] : [[fieldName, row.fieldID]];
    }),
  );
}

function itemFieldID(
  ids: SchemaIDs,
  item: FixtureItem,
  fieldName: FixtureItemField,
): number {
  const fieldID = ids.itemFields[item.itemType][fieldName];
  if (fieldID === undefined) {
    throw new Error(
      `item "${item.key}" names a ${fieldName}, which item type "${item.itemType}" cannot hold.`,
    );
  }
  return fieldID;
}

function venueFieldID(ids: SchemaIDs, item: FixtureItem): number {
  const roles = ids.roleFields[item.itemType];
  const fieldID = roles.container ?? roles.publisher;
  if (fieldID === null) {
    throw new Error(
      `item "${item.key}" names a Venue, which item type "${item.itemType}" cannot hold.`,
    );
  }
  return fieldID;
}

function publisherFieldID(ids: SchemaIDs, item: FixtureItem): number {
  const roles = ids.roleFields[item.itemType];
  if (roles.container === null || roles.publisher === null) {
    throw new Error(
      `item "${item.key}" names a publisher, which item type "${item.itemType}" cannot hold beside a Venue.`,
    );
  }
  return roles.publisher;
}

function seedDatabase(
  db: DatabaseSync,
  ids: SchemaIDs,
  {
    layout,
    data: { items, notes, attachments, annotations, libraries, collections },
    linkedAttachmentVaultDir,
  }: {
    layout: FixtureLayout;
    data: FixtureZoteroData;
    linkedAttachmentVaultDir?: string;
  },
): void {
  const insert = (sql: string, rows: readonly Row[]): void => {
    const statement = db.prepare(sql);
    for (const row of rows) statement.run(...row);
  };

  insert(
    "insert into libraries (libraryID, type, editable, filesEditable) values (?, ?, ?, ?)" +
      " on conflict (libraryID) do update set type = excluded.type," +
      " editable = excluded.editable, filesEditable = excluded.filesEditable",
    libraries.map((library) => [
      library.libraryID,
      library.type,
      library.editable,
      library.editable,
    ]),
  );
  insert(
    "insert into groups (groupID, libraryID, name, description, version) values (?, ?, ?, '', 0)",
    libraries
      .filter((library) => library.groupID !== null)
      .map((library) => [library.groupID, library.libraryID, library.name]),
  );

  insert(
    "insert into collections (collectionID, collectionName, parentCollectionID, libraryID, key) values (?, ?, ?, ?, ?)",
    collections.map((collection) => [
      collection.collectionID,
      collection.name,
      collection.parentCollectionID ?? null,
      collection.libraryID,
      collection.key,
    ]),
  );

  const itemRow = (
    item: {
      itemID: number;
      libraryID: number;
      key: string;
      dateAdded?: string;
      dateModified: string;
    },
    itemTypeID: number,
  ): Row => [
    item.itemID,
    itemTypeID,
    item.dateAdded ?? item.dateModified,
    item.dateModified,
    item.dateModified,
    item.libraryID,
    item.key,
  ];
  insert(
    "insert into items (itemID, itemTypeID, dateAdded, dateModified, clientDateModified, libraryID, key)" +
      " values (?, ?, ?, ?, ?, ?, ?)",
    [
      ...items.map((item) => itemRow(item, ids.itemTypes[item.itemType])),
      ...notes.map((note) => itemRow(note, ids.itemTypes.note)),
      ...attachments.map((attachment) =>
        itemRow(attachment, ids.itemTypes.attachment),
      ),
      ...annotations.map((annotation) =>
        itemRow(annotation, ids.itemTypes.annotation),
      ),
    ],
  );
  insert(
    "insert into itemNotes (itemID, parentItemID, note, title) values (?, ?, ?, ?)",
    notes.map((note) => [
      note.itemID,
      note.parentItemID,
      note.note,
      note.title,
    ]),
  );
  insert(
    "insert into itemAttachments (itemID, parentItemID, linkMode, contentType, charsetID, path, lastRead) values (?, ?, ?, ?, ?, ?, ?)",
    attachments.map((attachment) => [
      attachment.itemID,
      attachment.parentItemID,
      ATTACHMENT_LINK_MODES[attachment.linkMode],
      attachment.contentType,
      attachment.linkMode === "imported_url" &&
      attachment.contentType === "text/html"
        ? ids.charsets["utf-8"]
        : null,
      attachmentDatabasePath(attachment, layout, linkedAttachmentVaultDir),
      attachment.lastRead ?? null,
    ]),
  );
  insert(
    "insert into itemAnnotations (itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex, position, isExternal)" +
      " values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    annotations.map((annotation) => [
      annotation.itemID,
      annotation.parentItemID,
      annotation.type,
      annotation.text,
      annotation.comment,
      annotation.color,
      annotation.pageLabel,
      annotation.sortIndex,
      JSON.stringify(annotation.position),
      annotation.isExternal ? 1 : 0,
    ]),
  );

  seedItemData(insert, ids, { items, attachments });

  const creators = new Map<string, FixtureCreator & { creatorID: number }>();
  for (const creator of items.flatMap((item) => item.creators)) {
    const key = creatorKey(creator);
    if (!creators.has(key)) {
      creators.set(key, { creatorID: creators.size + 1, ...creator });
    }
  }
  insert(
    "insert into creators (creatorID, firstName, lastName, fieldMode) values (?, ?, ?, ?)",
    [...creators.values()].map((creator) => [
      creator.creatorID,
      creator.firstName,
      creator.lastName,
      creator.fieldMode,
    ]),
  );
  insert(
    "insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex) values (?, ?, ?, ?)",
    items.flatMap((item) =>
      item.creators.map((creator, orderIndex) => [
        item.itemID,
        creators.get(creatorKey(creator))!.creatorID,
        ids.creatorTypes[creator.creatorType],
        orderIndex,
      ]),
    ),
  );

  const tags = new Map<string, number>();
  for (const tag of [...items, ...attachments, ...annotations].flatMap(
    (item) => item.tags ?? [],
  )) {
    if (!tags.has(tag.name)) tags.set(tag.name, tags.size + 1);
  }
  insert(
    "insert into tags (tagID, name) values (?, ?)",
    [...tags].map(([name, tagID]) => [tagID, name]),
  );
  insert(
    "insert into itemTags (itemID, tagID, type) values (?, ?, ?)",
    [...items, ...attachments, ...annotations].flatMap((item) =>
      (item.tags ?? []).map((tag) => [
        item.itemID,
        tags.get(tag.name)!,
        tag.type,
      ]),
    ),
  );

  const relationPredicateID = ensureRelationPredicate(db);
  insert(
    "insert into itemRelations (itemID, predicateID, object) values (?, ?, ?)",
    items.flatMap((item) =>
      (item.relatedKeys ?? []).map((relatedKey) => [
        item.itemID,
        relationPredicateID,
        relatedItemUri(item, relatedKey, items),
      ]),
    ),
  );

  insert(
    "insert into deletedItems (itemID, dateDeleted) values (?, ?)",
    notes
      .filter((note) => note.trashed)
      .map((note) => [note.itemID, note.dateModified]),
  );

  insert(
    "insert into collectionItems (collectionID, itemID) values (?, ?)",
    [...items, ...notes].flatMap((item) =>
      item.collectionIDs.map((collectionID) => [collectionID, item.itemID]),
    ),
  );
}

function creatorKey({
  firstName,
  lastName,
  fieldMode,
}: FixtureCreator): string {
  return JSON.stringify([lastName, firstName, fieldMode]);
}

function ensureRelationPredicate(db: DatabaseSync): number {
  const existing = db
    .prepare(
      "select predicateID from relationPredicates where predicate = 'dc:relation'",
    )
    .get() as { predicateID: number } | undefined;
  if (existing) return existing.predicateID;

  const { predicateID } = db
    .prepare(
      "select coalesce(max(predicateID), 0) + 1 as predicateID from relationPredicates",
    )
    .get() as { predicateID: number };
  db.prepare(
    "insert into relationPredicates (predicateID, predicate) values (?, 'dc:relation')",
  ).run(predicateID);
  return predicateID;
}

function relatedItemUri(
  item: FixtureItem,
  relatedKey: string,
  items: readonly FixtureItem[],
): string {
  const target = items.find(
    (candidate) =>
      candidate.libraryID === item.libraryID && candidate.key === relatedKey,
  );
  if (!target) {
    throw new Error(
      `Related Item ${relatedKey} is not in library ${item.libraryID}.`,
    );
  }
  const library = LIBRARIES.find(
    (candidate) => candidate.libraryID === item.libraryID,
  )!;
  return library.groupID === null
    ? `http://zotero.org/users/local/fixture/items/${target.key}`
    : `http://zotero.org/groups/${library.groupID}/items/${target.key}`;
}

function seedItemData(
  insert: (sql: string, rows: readonly Row[]) => void,
  ids: SchemaIDs,
  {
    items,
    attachments,
  }: {
    items: readonly FixtureItem[];
    attachments: readonly FixtureAttachment[];
  },
): void {
  const fieldValues = [
    ...items.flatMap((item) => [
      { itemID: item.itemID, fieldID: ids.fields.title, value: item.title },
      { itemID: item.itemID, fieldID: ids.fields.date, value: item.date },
      ...(item.venue === undefined
        ? []
        : [
            {
              itemID: item.itemID,
              fieldID: venueFieldID(ids, item),
              value: item.venue,
            },
          ]),
      ...(item.publisher === undefined
        ? []
        : [
            {
              itemID: item.itemID,
              fieldID: publisherFieldID(ids, item),
              value: item.publisher,
            },
          ]),
      ...Object.entries(item.fields ?? {}).map(([fieldName, value]) => ({
        itemID: item.itemID,
        fieldID: itemFieldID(ids, item, fieldName as FixtureItemField),
        value,
      })),
      ...(item.citationKey === null
        ? []
        : [
            {
              itemID: item.itemID,
              fieldID: ids.fields.citationKey,
              value: item.citationKey,
            },
          ]),
    ]),
    ...attachments.flatMap((attachment) => [
      {
        itemID: attachment.itemID,
        fieldID: ids.fields.title,
        value: attachment.title,
      },
      ...(attachment.url === null
        ? []
        : [
            {
              itemID: attachment.itemID,
              fieldID: ids.fields.url,
              value: attachment.url,
            },
            {
              itemID: attachment.itemID,
              fieldID: ids.fields.accessDate,
              value: attachment.dateModified,
            },
          ]),
    ]),
  ];

  const valueIDs = new Map<string, number>();
  for (const { value } of fieldValues) {
    if (!valueIDs.has(value)) valueIDs.set(value, valueIDs.size + 1);
  }
  insert(
    "insert into itemDataValues (valueID, value) values (?, ?)",
    [...valueIDs].map(([value, valueID]) => [valueID, value]),
  );
  insert(
    "insert into itemData (itemID, fieldID, valueID) values (?, ?, ?)",
    fieldValues.map((entry) => [
      entry.itemID,
      entry.fieldID,
      valueIDs.get(entry.value)!,
    ]),
  );
}

const LOCAL_API_PREF =
  'user_pref("extensions.zotero.httpServer.localAPI.enabled", true);';

export const FIXTURE_LOCAL_API_SERVER_ID = "zotlitserver";

export const FIXTURE_LOCAL_API_WRITE_KEY = "zotlitFixtureWriteAuthorization1";

function writeLocalApiAuthorizations(
  layout: FixtureLayout,
  options: BuildOptions,
): Promise<void> {
  if (!options.localApi || options.grantLocalApiWrites !== true) {
    return Promise.resolve();
  }
  return writeJson(join(layout.profileDir, "localAPIKeys.json"), {
    keys: [
      {
        key: FIXTURE_LOCAL_API_WRITE_KEY,
        appName: "ZotLit Fixture",
        remember: true,
        createdAt: `${BUILD_TIMESTAMP.replace(" ", "T")}Z`,
      },
    ],
  });
}

function writePrefs(
  layout: FixtureLayout,
  options: BuildOptions,
): Promise<void> {
  const lines = [
    'user_pref("intl.locale.requested", "en-US");',
    'user_pref("intl.regional_prefs.use_os_locales", false);',
    'user_pref("extensions.zotero.useDataDir", true);',
    `user_pref("extensions.zotero.dataDir", ${JSON.stringify(layout.dataDir)});`,
    ...QUIET_FIRST_RUN_PREFS,
    ...OBSIDIAN_PROTOCOL_PREFS,
    ...BETTER_BIBTEX_PREFS,
    ...(options.localApi ? [LOCAL_API_PREF] : []),
    ...(options.zoteroHttpPort === undefined
      ? []
      : [
          `user_pref("extensions.zotero.httpServer.port", ${options.zoteroHttpPort});`,
        ]),
    ...(options.liveUpdatePort === undefined
      ? []
      : [
          'user_pref("extensions.zotlit.notify", true);',
          `user_pref("extensions.zotlit.notify-url", "http://${LIVE_UPDATE_HOSTNAME}:${options.liveUpdatePort}");`,
        ]),
    "",
  ];
  return writeFile(join(layout.profileDir, "prefs.js"), lines.join("\n"));
}

const SETTINGS_VERSION = 11;

const ZOTLIT_SIDEBAR_VIEW_TYPES = [
  "zotero-annotation-view",
  "zotlit-references",
  "zotlit-cited-by",
];

function workspaceLeaf(type: string): Record<string, unknown> {
  return { id: `zt-leaf-${type}`, type: "leaf", state: { type, state: {} } };
}

function workspacePreset(options: BuildOptions): Record<string, unknown> {
  return {
    main: {
      id: "zt-main",
      type: "split",
      direction: "vertical",
      children: [
        {
          id: "zt-main-tabs",
          type: "tabs",
          children: [workspaceLeaf("empty")],
        },
      ],
    },
    left: {
      id: "zt-left",
      type: "split",
      direction: "horizontal",
      width: 300,
      children: [
        {
          id: "zt-left-tabs",
          type: "tabs",
          children: [workspaceLeaf("file-explorer"), workspaceLeaf("search")],
        },
      ],
    },
    right: {
      id: "zt-right",
      type: "split",
      direction: "horizontal",
      width: 340,
      collapsed: false,
      children: [
        {
          id: "zt-right-tabs",
          type: "tabs",
          currentTab: 0,
          children: [
            ...(holdsZotLit(options.plugins ?? [])
              ? ZOTLIT_SIDEBAR_VIEW_TYPES.map(workspaceLeaf)
              : []),
            workspaceLeaf("backlink"),
            workspaceLeaf("outgoing-link"),
          ],
        },
      ],
    },
    active: "zt-leaf-empty",
    lastOpenFiles: [],
  };
}

async function writeVault(
  layout: FixtureLayout,
  options: BuildOptions,
): Promise<void> {
  const vaultCase = findVaultCase(options.vaultCase ?? DEFAULT_VAULT_CASE);
  const scopeCase = findScopeCase(options.scopeCase ?? DEFAULT_SCOPE_CASE);
  if (vaultCase.id === "fresh" && scopeCase.id !== DEFAULT_SCOPE_CASE) {
    throw new Error(
      `the fresh Vault Case writes no settings file, so it cannot save the "${scopeCase.id}" Scope Case`,
    );
  }

  await writeVaultConfig(layout, options);
  if (vaultCase.id === "fresh") {
    await rm(layout.pluginDataPath, { force: true });
    return;
  }

  if (vaultCase.id === "docs") {
    await cp(DEMO_PAGES_DIR, layout.vaultDir, { recursive: true });
    await rm(layout.pluginDataPath, { force: true });
    return;
  }

  if (vaultCase.id === "demo") {
    await cp(DEMO_PAGES_DIR, layout.vaultDir, { recursive: true });
    await mkdir(join(layout.vaultDir, "templates"), { recursive: true });
    await writeFile(
      join(layout.vaultDir, "templates", DEMO_PROFILE_DOCUMENT.filename),
      DEMO_PROFILE_DOCUMENT.source,
    );
  } else if (vaultCase.id === "graph") {
    await writeGraphVault(layout);
  } else {
    await writeVaultNotes(
      layout,
      options,
      vaultCase.id === "upgrader" ? [] : LITERATURE_NOTE_PROFILES,
    );
  }
  if (vaultCase.id === "upgrader") {
    await writeLegacyTemplates(layout);
  } else if (vaultCase.ownItems === undefined) {
    for (const document of LITERATURE_NOTE_DOCUMENTS) {
      await writeFile(
        join(layout.vaultDir, "templates", document.filename),
        document.source,
      );
    }
    for (const partial of SHARED_PARTIAL_DOCUMENTS) {
      await writeFile(
        join(layout.vaultDir, "templates", `zotlit-partial.${partial.name}.md`),
        formatPlainTemplateDocument(partial.source, partial.language),
      );
    }
    await writeFile(
      join(layout.vaultDir, "templates", "zotlit-citation.md"),
      formatPlainTemplateDocument(fixtureCitationSource(), "liquid"),
    );
  }

  await writeJson(
    layout.pluginDataPath,
    vaultSettings(vaultCase, scopeCase.scope, options),
  );
}

async function writeVaultConfig(
  layout: FixtureLayout,
  options: BuildOptions,
): Promise<void> {
  const configDir = join(layout.vaultDir, ".obsidian");
  await mkdir(layout.pluginDir, { recursive: true });

  await writeJson(join(configDir, "app.json"), {});
  await writeJson(join(configDir, "appearance.json"), { nativeMenus: false });
  await writeJson(join(configDir, "community-plugins.json"), [
    "hot-reload",
    ...(options.plugins ?? []).map(({ id }) => id),
  ]);
  await writeJson(join(configDir, "core-plugins.json"), {
    "file-explorer": true,
    "global-search": true,
    switcher: true,
    backlink: true,
    "outgoing-link": true,
    properties: true,
    "page-preview": true,
    "command-palette": true,
    "editor-status": true,
    outline: true,
    ...findVaultCase(options.vaultCase ?? DEFAULT_VAULT_CASE).corePlugins,
  });
  await writeJson(join(configDir, "workspace.json"), workspacePreset(options));
  if ((options.vaultCase ?? DEFAULT_VAULT_CASE) !== "docs") {
    await writeJson(join(configDir, "types.json"), {
      types: VAULT_PROPERTY_TYPES,
    });
  }
  await cp(
    join(VAULT_PLUGINS_DIR, "hot-reload"),
    join(configDir, "plugins", "hot-reload"),
    { recursive: true },
  );

  for (const { id, bundleDir } of [
    ...(options.plugins ?? []),
    ...(options.installed ?? []),
  ]) {
    await cp(bundleDir, join(configDir, "plugins", id), { recursive: true });
  }
}

async function writeVaultNotes(
  layout: FixtureLayout,
  options: BuildOptions,
  profiles: readonly (typeof LITERATURE_NOTE_PROFILES)[number][],
): Promise<void> {
  await mkdir(join(layout.vaultDir, "literatures"), { recursive: true });
  await mkdir(join(layout.vaultDir, "templates"), { recursive: true });
  await mkdir(join(layout.vaultDir, "zotero_notes"), { recursive: true });
  for (const profile of profiles) {
    await mkdir(
      join(layout.vaultDir, profile.bindings["note.literature-folder"]),
      { recursive: true },
    );
  }
  await cp(VAULT_PAGES_DIR, layout.vaultDir, { recursive: true });
  await writeFile(
    join(layout.vaultDir, "mark-landing-test.md"),
    markLandingPage(layout, options),
  );

  for (const item of ITEMS.filter(
    (candidate) =>
      candidate.libraryID === USER_LIBRARY_ID &&
      !DEMO_ITEMS.includes(candidate) &&
      candidate.literatureNotePage === undefined,
  )) {
    const profile = profiles.find(
      ({ id }) => id === item.literatureNoteProfile,
    );
    await writeFile(
      join(
        layout.vaultDir,
        profile?.bindings["note.literature-folder"] ?? "literatures",
        `${item.literatureNoteName ?? item.key}.md`,
      ),
      literatureNote(item, layout, {
        profile,
        linkedAttachmentVaultDir: options.linkedAttachmentVaultDir,
      }),
    );
  }

  for (const note of NOTES.filter(
    (candidate) => candidate.parentItemID !== null && !candidate.trashed,
  )) {
    if (note.importedNoteBody === null) {
      throw new Error(`Child Note ${note.key} needs an Imported Note body`);
    }
    const indexedKey = fixtureIndexedKey(note);
    await writeFile(
      join(layout.vaultDir, "zotero_notes", `${indexedKey}.md`),
      importedNote(note, indexedKey, note.importedNoteBody),
    );
  }
}

async function writeGraphVault(layout: FixtureLayout): Promise<void> {
  await cp(GRAPH_PAGES_DIR, layout.vaultDir, { recursive: true });
  await mkdir(join(layout.vaultDir, "literatures"), { recursive: true });
  for (const item of GRAPH_ITEMS.filter(
    ({ libraryID }) => libraryID === USER_LIBRARY_ID,
  )) {
    await writeFile(
      join(layout.vaultDir, "literatures", `${item.citationKey}.md`),
      graphLiteratureNote(item),
    );
  }
  await writeJson(
    join(layout.vaultDir, ".obsidian", "graph.json"),
    GRAPH_VIEW_OPTIONS,
  );
}

function graphLiteratureNote(item: FixtureItem): string {
  const body = GRAPH_LITERATURE_NOTE_BODIES[item.citationKey ?? ""];
  if (body === undefined) {
    throw new Error(`Graph Item ${item.key} needs a Literature Note body`);
  }
  return [
    "---",
    `title: ${JSON.stringify(item.title)}`,
    `zotero-key: ${item.key}`,
    `citekey: ${item.citationKey}`,
    "---",
    `# ${item.title}`,
    "",
    `[Zotero](zotero://select/library/items/${item.key})`,
    "",
    "## Reading notes",
    "",
    body,
    "",
    renderedAnnotationsSection(),
    "",
  ].join("\n");
}

async function writeLegacyTemplates(layout: FixtureLayout): Promise<void> {
  for (const template of UPGRADER_LEGACY_TEMPLATES) {
    await writeFile(
      join(layout.vaultDir, "templates", legacyTemplateFilename(template)),
      await legacyTemplateSource(template),
    );
  }
}

export function legacyTemplateFilename(
  template: FixtureLegacyTemplate,
): string {
  return `zotlit-${template.name}.${template.language}.md`;
}

export async function legacyTemplateSource(
  template: FixtureLegacyTemplate,
): Promise<string> {
  const origin = "from" in template ? template.from : template.name;
  return applyTemplateEdit(
    await shippedDefaultSource(origin, template.language),
    template,
    `the default ${origin} template`,
  );
}

const CITATION_SLOT_VARIANTS: Partial<
  Record<FixtureLegacyTemplateOrigin, "main" | "alt">
> = { cite: "main", cite2: "alt" };

async function shippedDefaultSource(
  origin: FixtureLegacyTemplateOrigin,
  language: "liquid" | "eta",
): Promise<string> {
  const variant = CITATION_SLOT_VARIANTS[origin];
  if (variant) return `${DEFAULT_CITATION_BRANCHES[language][variant]}\n`;
  if (origin === "annotation")
    return language === "liquid"
      ? DEFAULT_ANNOTATION_LIQUID
      : DEFAULT_ANNOTATION_ETA;
  return await readFile(
    new URL(
      import.meta.resolve(`@zotlit/templates/defaults/${origin}.${language}`),
    ),
    "utf-8",
  );
}

export function fixtureCitationSource(): string {
  return applyTemplateEdit(
    readFileSync(
      new URL(
        import.meta.resolve("@zotlit/templates/defaults/citation.liquid"),
      ),
      "utf-8",
    ),
    CITATION_DOCUMENT_EDIT,
    "the default citation template",
  );
}

function applyTemplateEdit(
  source: string,
  edit: FixtureTemplateEdit,
  subject: string,
): string {
  if (!source.includes(edit.find)) {
    throw new Error(
      `${subject} no longer contains ${JSON.stringify(edit.find)}; update the Fixture Spec`,
    );
  }
  return source.replace(edit.find, edit.replace);
}

function vaultSettings(
  vaultCase: FixtureVaultCase,
  scope: PersistedLibraryScope,
  { liveUpdatePort, upgraderFields }: BuildOptions,
): Record<string, unknown> {
  const shared = {
    "server.enabled": true,
    ...(liveUpdatePort === undefined ? {} : { "server.port": liveUpdatePort }),
    [LIBRARY_SCOPE_SETTING_KEY]: scope,
    ...(vaultCase.id === "graph" ? { "citation.graph-citations": true } : {}),
  };
  if (vaultCase.id === "upgrader") {
    return {
      __VERSION__: UPGRADER_SETTINGS_VERSION,
      "note.literature-folder": "literatures",
      "note.import-folder": "zotero_notes",
      "note.frontmatter-fields": upgraderFields ?? UPGRADER_FRONTMATTER_FIELDS,
      "release.previous-version": UPGRADER_PLUGIN_VERSION,
      ...shared,
    };
  }
  return {
    __VERSION__: SETTINGS_VERSION,
    "note.default-profile": {
      bindings: {
        "note.literature-folder": "literatures",
        "citation.references-style": null,
        "note.import-folder": "zotero_notes",
        "note.import-colored-highlights": false,
        "note.import-annotations-as-template": false,
      },
    },
    ...shared,
  };
}

function literatureNote(
  item: FixtureItem,
  layout: FixtureLayout,
  options: {
    profile?: (typeof LITERATURE_NOTE_PROFILES)[number];
    linkedAttachmentVaultDir?: string;
  },
): string {
  const attachments = ATTACHMENTS.filter(
    (attachment) =>
      attachment.parentItemID === item.itemID &&
      attachment.sourceAsset !== null,
  ).map((attachment) => {
    const path = attachmentFilePath(
      attachment,
      layout,
      options.linkedAttachmentVaultDir,
    )!;
    return `[${attachment.path}](${pathToFileURL(path).href})`;
  });
  const { profile } = options;
  if (item.literatureNoteRendered === true) {
    return renderedLiteratureNote(item, layout, options);
  }
  return [
    "---",
    `title: ${JSON.stringify(item.title)}`,
    `zotero-key: ${item.key}`,
    ...(profile === undefined
      ? []
      : [`zotlit-profile: ${profile.label} (${profile.id})`]),
    ...(item.citationKey === null ? [] : [`citekey: ${item.citationKey}`]),
    ...vaultPropertyLines(item.vaultProperties ?? {}),
    "---",
    `# ${item.title}`,
    "",
    ...(profile === undefined
      ? []
      : [
          "%%zt-managed%%",
          "## Book details",
          "",
          `Citation key: ${item.citationKey ?? ""}`,
          "",
          "> [!info] Book details",
          `> Type: ${item.itemType}`,
          `> Citation key: ${item.citationKey ?? item.key}`,
          "%%/zt-managed%%",
          "",
        ]),
    ...(item.literatureNoteCitations === undefined
      ? []
      : [
          `This note rests on ${item.literatureNoteCitations
            .map((key) => `[@${key}]`)
            .join(" ")}.`,
          "",
        ]),
    ...attachments,
    ...(attachments.length === 0 ? [] : [""]),
    ...(item.literatureNoteQueryBlock === true ? QUERY_BLOCK : []),
  ].join("\n");
}

function vaultPropertyLines(
  properties: Readonly<Record<string, FixtureVaultValue>>,
): string[] {
  return Object.entries(properties).flatMap(([name, value]) => {
    if (value === null) return [`${name}:`];
    if (typeof value === "object") {
      return value.length === 0
        ? [`${name}: []`]
        : [`${name}:`, ...value.map((entry) => `  - ${JSON.stringify(entry)}`)];
    }
    return [`${name}: ${JSON.stringify(value)}`];
  });
}

function renderedAnnotationsSection(): string {
  const source = readFileSync(
    new URL(import.meta.resolve("@zotlit/templates/defaults/content.liquid")),
    "utf-8",
  );
  const start = source.indexOf("## Annotations\n");
  const section = source.slice(start).trimEnd();
  if (start === -1 || section.includes("{%") || section.includes("{{")) {
    throw new Error(
      "the default content template no longer ends with a plain Annotations section; update the Fixture",
    );
  }
  return section;
}

const RENDERED_NOTE_EMBED = "Lab annotations.zotquery#This item";

function renderedLiteratureNote(
  item: FixtureItem,
  layout: FixtureLayout,
  options: { linkedAttachmentVaultDir?: string },
): string {
  if (item.libraryID !== USER_LIBRARY_ID) {
    throw new Error(
      `Rendered Literature Note ${item.key} must be in My Library`,
    );
  }
  if (NOTES.some(({ parentItemID }) => parentItemID === item.itemID)) {
    throw new Error(
      `Rendered Literature Note ${item.key} must have no child Notes`,
    );
  }
  const fileLinks = ATTACHMENTS.filter(
    (attachment) =>
      attachment.parentItemID === item.itemID &&
      attachment.sourceAsset !== null,
  ).map((attachment) => {
    const path = attachmentFilePath(
      attachment,
      layout,
      options.linkedAttachmentVaultDir,
    )!;
    return `[${basename(path)}](${pathToFileURL(path).href})`;
  });
  return [
    "---",
    `title: ${JSON.stringify(item.title)}`,
    `zotero-key: ${item.key}`,
    ...(item.citationKey === null ? [] : [`citekey: ${item.citationKey}`]),
    ...vaultPropertyLines(item.vaultProperties ?? {}),
    "---",
    `# ${item.title}`,
    "",
    [`[Zotero](zotero://select/library/items/${item.key})`, ...fileLinks].join(
      " ",
    ),
    "",
    "%%zt-managed%%",
    renderedAnnotationsSection(),
    "",
    "%%/zt-managed%%",
    "",
    "The Annotations of this note's Item, from a Query File.",
    "",
    `![[${RENDERED_NOTE_EMBED}]]`,
    "",
    ...(item.literatureNoteCitations === undefined
      ? []
      : [
          `This note rests on ${item.literatureNoteCitations
            .map((key) => `[@${key}]`)
            .join(" ")}.`,
          "",
        ]),
  ].join("\n");
}

const QUERY_BLOCK = [
  "```zotquery",
  "views:",
  "  - type: annotations",
  "    name: This item",
  "    from: annotations",
  "    filters: item == this.item",
  "    limit: 100",
  "```",
  "",
];

function markLandingPage(layout: FixtureLayout, options: BuildOptions): string {
  const link = (
    attachmentKey: string,
    label: string,
    anchor: { page?: number | null; annotation?: string | null },
  ): string => {
    const attachment = ATTACHMENTS.find(({ key }) => key === attachmentKey)!;
    const path = attachmentFilePath(
      attachment,
      layout,
      options.linkedAttachmentVaultDir,
    )!;
    const href = pathToFileURL(path).href;
    return `[${label}](${href}${formatAnnotationSubpath(anchor)})`;
  };
  const rougier = (label: string, anchor: Parameters<typeof link>[2]): string =>
    link("RGRPDF24", label, anchor);

  return `---
title: Mark Landing Test
---

# Mark Landing Test

This note exercises Mark Landing: an Attachment File Link carrying an
Annotation Anchor opens the PDF in Obsidian's reader, selects the Annotation's
own Mark, and scrolls it into view.

**Settings for a full pass**: **Open PDF file links in Obsidian** on, in
**Settings → ZotLit → Reader**. Zotero running, so the Annotations resolve.

**Pass condition for every landing case below**: the reader opens on the page
the Annotation sits on, exactly one Mark carries the selection outline, that
Mark is on screen, and no Mark Popup opens.

## A Mark on the page the reader opens

\`PUPR5FG5\` is a highlight on page 1 of the Rougier PDF, a linked file inside
the vault. Page 1 has rendered by the time the Landing resolves, so the Mark is
selected at once.

- File link: ${rougier("rougier-2014.pdf", { page: 1, annotation: "PUPR5FG5" })}
- Wikilink: [[attachments/rougier-2014.pdf#page=1&zt-annotation=PUPR5FG5]]

Both cross \`WorkspaceLeaf.setEphemeralState\`, so both land the same way. The
wikilink proves the notation is writable by hand, not an internal detail.

## A Mark on a page that has not rendered

\`FDRFQ7C2\` is the image annotation on page 2. That page is unbuilt when the
reader opens, so the Landing waits for its render instead of for an event that
never comes.

- ${rougier("rougier-2014.pdf", { page: 2, annotation: "FDRFQ7C2" })}

## The Annotation wins over the page the link names

This link names page 1 and an Annotation that sits on page 2. The Indexed Key is
the durable identity and the page is a hint, so the reader lands on page 2 — the
behaviour a replaced PDF depends on.

- ${rougier("rougier-2014.pdf", { page: 1, annotation: "FDRFQ7C2" })}

## A reader that is already open re-aims

Click the page 1 case, then this one, without closing the tab. The open reader
takes the new Annotation. Obsidian's own **Copy link to annotation** lands on
the first click and does nothing on the second; this one lands every time.

- ${rougier("rougier-2014.pdf", { page: 1, annotation: "K3JRFLFQ" })}

Click the same link twice. The second click lands exactly like the first.

## A PDF in Zotero storage, outside the vault

\`HIGHLGHT\` is on the Sakima's Song PDF, imported into Zotero's storage rather
than linked into the vault.

- ${link("PDFSTR22", "sakimas-song.pdf", { page: 2, annotation: "HIGHLGHT" })}

## Degrades to the page, in silence

Each case here lands on the page Obsidian jumped to, selects nothing, and shows
no notice. Each writes one \`debug\` record naming the reason.

- An Annotation Zotero does not have: ${rougier("rougier-2014.pdf", { page: 1, annotation: "MISSING2" })}
- An Annotation of another Attachment: ${rougier("rougier-2014.pdf", { page: 1, annotation: "HIGHLGHT" })}
- No Anchor at all: ${rougier("rougier-2014.pdf", { page: 2 })}

## Zotero's own annotation link stays Zotero's

ZotLit does not claim Zotero's own annotation deep link. ADR 0046 defers that as
the next step rather than rejecting it.

- [Ten Simple Rules for Better Figures](zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=2)

**Pass condition**: Zotero comes forward and opens its own reader on that
annotation. Obsidian's reader does not open, and no ZotLit notice appears.
`;
}

function fixtureIndexedKey(note: FixtureNote): string {
  const groupID = LIBRARIES.find(
    (library) => library.libraryID === note.libraryID,
  )!.groupID;
  return formatIndexedKey(note.key, groupID);
}

function importedNote(
  note: FixtureNote,
  indexedKey: string,
  body: string,
): string {
  const instant = `${note.dateModified.replace(" ", "T")}Z`;
  return [
    "---",
    `date: ${instant}`,
    `zotero-note-key: ${indexedKey}`,
    `zotero-lastmod: ${instant}`,
    "---",
    body,
    "",
  ].join("\n");
}

function writeJson(path: string, value: unknown): Promise<void> {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
