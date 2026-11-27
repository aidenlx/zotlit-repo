import type { ZoteroDatabase } from "#client/database.ts";
import { sql } from "drizzle-orm";
import { DatabaseSync } from "node:sqlite";

import { openScenarioDatabase } from "@zotlit/db-testing/scenario";
import type { ScenarioDatabase } from "@zotlit/db-testing/scenario";
import { exportWebApiLibraries } from "@zotlit/db-testing/web-api";
import type { WebApiLibraryExport } from "@zotlit/db-testing/web-api";

import { applyRecords, upsertGroupLibrary } from "#replica/apply.ts";
import type { ApplyResult } from "#replica/apply.ts";
import { createReplica, writeReplicaAccount } from "#replica/create.ts";

import { connectClient } from "#desktop/node-client.ts";

export const PARITY_USER = { userID: 7654321, username: "replica-reader" } as const;

type Run = (
  statement: string,
  ...params: (string | number)[]
) => {
  lastInsertRowid: number | bigint;
};

interface PreparationStep {
  readonly reason: string;
  readonly apply: (run: Run, sqlite: DatabaseSync) => void;
}

export const DESKTOP_PREPARATION: Readonly<Record<string, PreparationStep>> = {
  accountUserID: {
    reason:
      "settings account.userID and username: a database that syncs with the Web API has them; the replica gets them from the API key, and item URIs use the user ID",
    apply: (run) => {
      run(
        "insert into settings (setting, key, value) values ('account', 'userID', ?)",
        PARITY_USER.userID,
      );
      run(
        "insert into settings (setting, key, value) values ('account', 'username', ?)",
        PARITY_USER.username,
      );
    },
  },
  noteWrapper: {
    reason:
      'itemNotes.note in the <div class="zotero-note znv1"> wrapper: the client adds it on save and rewrites a note without it on load',
    apply: (run) =>
      run(
        `update itemNotes set note = '<div class="zotero-note znv1">' || note || '</div>' where note not like '<div class="zotero-note znv%'`,
      ),
  },
  emptyAttachmentPath: {
    reason:
      "itemAttachments.path NULL for '': the client stores NULL for an empty path",
    apply: (run) =>
      run("update itemAttachments set path = null where path = ''"),
  },
  annotationTextByType: {
    reason:
      "itemAnnotations.text NULL on note, image, ink and text annotations: the client refuses text on those types, and the Web API has none",
    apply: (run) =>
      run("update itemAnnotations set text = null where type not in (1, 5)"),
  },
  invalidAccessDate: {
    reason:
      "the accessDate 'yesterday' removed: the client discards an access date that is not a date",
    apply: (run) =>
      run(
        `delete from itemData where valueID in (select valueID from itemDataValues where value = 'yesterday')
          and fieldID = (select fieldID from fieldsCombined where fieldName = 'accessDate')`,
      ),
  },
  customFields: {
    reason:
      "custom fields and their values removed: the Web API has no custom fields",
    apply: (run) => {
      run(
        "delete from itemData where fieldID in (select fieldID from fieldsCombined where custom = 1)",
      );
      run("delete from fieldsCombined where custom = 1");
      run("delete from customFields");
    },
  },
  baseFieldBesideMapped: {
    reason:
      "a base-field value removed where the item type maps the base field (publicationTitle of a bookSection beside its bookTitle): the client stores one value for the mapped pair",
    apply: (run) =>
      run(
        `delete from itemData where exists (
          select 1 from items i join baseFieldMappingsCombined m on m.itemTypeID = i.itemTypeID
          where i.itemID = itemData.itemID and m.baseFieldID = itemData.fieldID)`,
      ),
  },
  nfcText: {
    reason:
      "field values, tag names and creator names in Unicode NFC: the client normalizes each value it stores, and the scenario has a decomposed é",
    apply: (run, sqlite) => {
      for (const [table, id, column] of [
        ["itemDataValues", "valueID", "value"],
        ["tags", "tagID", "name"],
        ["creators", "creatorID", "firstName"],
        ["creators", "creatorID", "lastName"],
      ] as const) {
        const rows = sqlite
          .prepare(`select ${id} as id, ${column} as text from ${table}`)
          .all() as { id: number; text: unknown }[];
        for (const row of rows) {
          if (
            typeof row.text === "string" &&
            row.text !== row.text.normalize()
          ) {
            run(
              `update ${table} set ${column} = ? where ${id} = ?`,
              row.text.normalize(),
              row.id,
            );
          }
        }
      }
    },
  },
  invalidPosition: {
    reason:
      "the annotation ANN2BAD2 with the position 'invalid JSON' removed: the client writes the position as JSON, and the annotation readers fail on it in both databases",
    apply: (run) => {
      run("delete from itemAnnotations where position = 'invalid JSON'");
      run(
        "delete from itemTags where itemID in (select itemID from items where key = 'ANN2BAD2')",
      );
      run("delete from items where key = 'ANN2BAD2'");
    },
  },
  unusedValues: {
    reason:
      "itemDataValues rows that no item uses removed: the client purges them",
    apply: (run) =>
      run(
        "delete from itemDataValues where valueID not in (select valueID from itemData)",
      ),
  },
  citationKeys: {
    reason:
      "citationKey values added to three items, one with only digits: the scenario has none, and the citation key readers need data",
    apply: (run, sqlite) => {
      const { fieldID } = sqlite
        .prepare(
          "select fieldID from fieldsCombined where fieldName = 'citationKey' and custom = 0",
        )
        .get() as { fieldID: number };
      for (const [key, libraryID, citationKey] of CITATION_KEYS) {
        const valueID = Number(
          run("insert into itemDataValues (value) values (?)", citationKey)
            .lastInsertRowid,
        );
        run(
          "insert into itemData (itemID, fieldID, valueID) select itemID, ?, ? from items where key = ? and libraryID = ?",
          fieldID,
          valueID,
          key,
          libraryID,
        );
      }
    },
  },
  relations: {
    reason:
      "itemRelations added (dc:relation, owl:sameAs): the scenario has none, and the relation reader needs data",
    apply: (run) => {
      for (const [predicate, object] of [
        [
          "dc:relation",
          `http://zotero.org/users/${PARITY_USER.userID}/items/BK2MNTH2`,
        ],
        [
          "dc:relation",
          `http://zotero.org/users/${PARITY_USER.userID}/items/CHP2YEAR`,
        ],
        ["owl:sameAs", "http://zotero.org/groups/4815/items/ART2FULL"],
      ] as const) {
        run(
          "insert or ignore into relationPredicates (predicate) values (?)",
          predicate,
        );
        run(
          `insert into itemRelations (itemID, predicateID, object)
            select i.itemID, p.predicateID, ? from items i, relationPredicates p where i.key = 'ART2FULL' and i.libraryID = 1 and p.predicate = ?`,
          object,
          predicate,
        );
      }
    },
  },
};

export const CITATION_KEYS = [
  ["ART2FULL", 1, "lovelace2020"],
  ["BK2MNTH2", 1, "2020"],
  ["GRP2BK22", 2, "group2022"],
] as const;

export const PARITY_LEAVES_OUT = {
  savedSearches:
    "saved searches are not stored; no reader reads them",
  collectionRelations:
    "collection relations are not stored; no reader reads them",
  publicationsItems:
    "My Publications membership (inPublications) is not stored; no reader reads it",
  syncedSettings:
    "synced settings are not stored; no reader reads them. The lastRead_g settings of the personal library go to itemAttachments.lastRead of the group attachment, as the client applies them",
  triggers:
    "the replica has no triggers of the Zotero database; the writer keeps the rules they enforce",
  "deletedItems.dateDeleted":
    "the Web API gives no trash date; the replica stores the time of the sync",
  "deletedCollections.dateDeleted":
    "the Web API gives no trash date; the replica stores the time of the sync",
  "items.clientDateModified":
    "a local edit time that the Web API does not carry",
  "collections.clientDateModified":
    "a local edit time that the Web API does not carry",
  "collectionItems.orderIndex":
    "the client numbers a new member after the last of its collection; the scenario numbers them by item",
  "itemAttachments.syncState":
    "the state of a local file, which the replica does not have",
  "itemAttachments.storageModTime": "the state of a local file",
  "itemAttachments.storageHash": "the state of a local file",
  "itemDataValues.valueNormalized":
    "search columns of the client; no reader reads them",
  "tags.nameNormalized": "search columns of the client; no reader reads them",
  "creators.firstNameNormalized":
    "search columns of the client; no reader reads them",
  "creators.lastNameNormalized":
    "search columns of the client; no reader reads them",
  "itemAnnotations.textNormalized":
    "search columns of the client; no reader reads them",
  "itemAnnotations.commentNormalized":
    "search columns of the client; no reader reads them",
  "libraries.editable":
    "the client derives write access from the group role and the key; the replica is read-only and stores 0",
  "libraries.filesEditable":
    "the client derives file write access from the group role and the key; the replica stores 0",
} as const;

export const PARITY_LEAVES_OUT_SENTINELS: Readonly<Record<string, string | number>> = {
  "deletedItems.dateDeleted": "1999-01-02 03:04:05",
  "deletedCollections.dateDeleted": "1999-01-02 03:04:05",
  "items.clientDateModified": "1999-01-02 03:04:05",
  "collections.clientDateModified": "1999-01-02 03:04:05",
  "collectionItems.orderIndex": 97,
  "itemAttachments.syncState": 3,
  "itemAttachments.storageModTime": 123456789,
  "itemAttachments.storageHash": "0123456789abcdef0123456789abcdef",
  "itemDataValues.valueNormalized": "sentinel",
  "tags.nameNormalized": "sentinel",
  "creators.firstNameNormalized": "sentinel",
  "creators.lastNameNormalized": "sentinel",
  "itemAnnotations.textNormalized": "sentinel",
  "itemAnnotations.commentNormalized": "sentinel",
  "libraries.editable": 1,
  "libraries.filesEditable": 1,
};

export function writeParitySentinels(db: ZoteroDatabase): void {
  for (const [column, sentinel] of Object.entries(PARITY_LEAVES_OUT_SENTINELS)) {
    const [table, name] = column.split(".") as [string, string];
    db.run(
      sql`update ${sql.identifier(table)} set ${sql.identifier(name)} = ${sentinel}`,
    );
  }
}

function prepareDesktop(sqlite: DatabaseSync): void {
  const run: Run = (statement, ...params) =>
    sqlite.prepare(statement).run(...params);
  for (const step of Object.values(DESKTOP_PREPARATION))
    step.apply(run, sqlite);
}


export interface ReplicaClient {
  readonly db: ZoteroDatabase;
  close(): void;
}

export interface ParityPair extends Disposable {
  readonly desktop: ScenarioDatabase<ZoteroDatabase>;
  readonly replica: ReplicaClient;
  readonly records: readonly WebApiLibraryExport[];
  readonly results: readonly ApplyResult[];
}

export interface ParityPairOptions {
  readonly openReplica?: () => ReplicaClient;
  readonly withSentinels?: boolean;
}

export function openNodeReplica(): ReplicaClient {
  const sqlite = new DatabaseSync(":memory:", {
    enableForeignKeyConstraints: false,
  });
  return { db: connectClient(sqlite), close: () => sqlite.close() };
}

export function openParityPair({
  openReplica = openNodeReplica,
  withSentinels = false,
}: ParityPairOptions = {}): ParityPair {
  const desktop = openScenarioDatabase<ZoteroDatabase>(connectClient, {
    annotations: true,
  });
  prepareDesktop(desktop.sqlite);
  const records = exportWebApiLibraries(desktop.sqlite, PARITY_USER);
  const replica = openReplica();
  const { db } = replica;
  const results: ApplyResult[] = [];
  db.transaction(() => {
    createReplica(db);
    writeReplicaAccount(db, PARITY_USER);
    for (const library of records) {
      const libraryID = library.group ? upsertGroupLibrary(db, library.group) : 1;
      results.push(
        applyRecords(db, {
          libraryID,
          collections: library.collections,
          items: library.items,
        }),
      );
    }
    if (withSentinels) writeParitySentinels(db);
  });
  return {
    desktop,
    replica,
    records,
    results,
    [Symbol.dispose]: () => {
      desktop.close();
      replica.close();
    },
  };
}
