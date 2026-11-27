import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { openScenarioDatabase } from "@zotlit/db-testing/scenario";
import { exportWebApiLibraries } from "@zotlit/db-testing/web-api";
import { setLibraryLogSink } from "@zotlit/shared/logging";
import type { LibraryLogRecord } from "@zotlit/shared/logging";
import type {
  WebApiCollection,
  WebApiGroup,
  WebApiItem,
  WebApiItemData,
} from "@zotlit/zotero-types/web-api";

import golden from "./__fixtures__/web-api-public-group.json" with { type: "json" };
import sandbox from "./__fixtures__/web-api-sandbox-user.json" with { type: "json" };
import {
  applyRecords,
  findItemID,
  findItemKey,
  findLibraryID,
  upsertGroupLibrary,
} from "./apply.ts";
import { createReplica } from "./create.ts";

import { connectClient } from "#desktop/node-client.ts";

const GROUP = golden.group as WebApiGroup;
const GOLDEN_COLLECTIONS = golden.collections as WebApiCollection[];
const GOLDEN_ITEMS = golden.items as WebApiItem[];

afterEach(() => setLibraryLogSink(undefined));

function openReplica(foreignKeys = false) {
  const sqlite = new DatabaseSync(":memory:", {
    enableForeignKeyConstraints: foreignKeys,
  });
  const db = connectClient(sqlite);
  createReplica(db);
  return { sqlite, db };
}

function fieldsOf(sqlite: DatabaseSync, libraryID: number, key: string) {
  return Object.fromEntries(
    (
      sqlite
        .prepare(
          `select f.fieldName, v.value from items i join itemData d using (itemID)
          join fieldsCombined f using (fieldID) join itemDataValues v using (valueID)
          where i.libraryID = ? and i.key = ?`,
        )
        .all(libraryID, key) as { fieldName: string; value: string }[]
    ).map((row) => [row.fieldName, row.value]),
  );
}

function scenarioRecords(withoutMeta = false) {
  using desktop = openScenarioDatabase(connectClient, { annotations: true });
  desktop.sqlite.exec(
    `update itemNotes set note = '<div class="zotero-note znv1">' || note || '</div>'`,
  );
  return exportWebApiLibraries(desktop.sqlite, {
    userID: 7654321,
    username: "reader",
    withoutMeta,
  });
}

function applyScenario(
  db: ReturnType<typeof openReplica>["db"],
  withoutMeta = false,
  now?: Temporal.Instant,
) {
  const results = [];
  for (const library of scenarioRecords(withoutMeta)) {
    const libraryID = library.group ? upsertGroupLibrary(db, library.group) : 1;
    results.push(
      applyRecords(
        db,
        {
          libraryID,
          collections: library.collections,
          items: library.items,
        },
        now === undefined ? {} : { now },
      ),
    );
  }
  return results;
}

const DUMPED_TABLES = [
  "items",
  "itemData",
  "itemDataValues",
  "creators",
  "itemCreators",
  "tags",
  "itemTags",
  "itemRelations",
  "relationPredicates",
  "collections",
  "collectionItems",
  "deletedItems",
  "deletedCollections",
  "itemNotes",
  "itemAttachments",
  "itemAnnotations",
  "groupItems",
  "users",
  "libraries",
  "groups",
];

function dump(sqlite: DatabaseSync) {
  return Object.fromEntries(
    DUMPED_TABLES.map((table) => [
      table,
      sqlite.prepare(`select * from ${table} order by 1, 2`).all(),
    ]),
  );
}

describe("records of a real Web API library", () => {
  it("stores the public group's records as the Zotero client does", () => {
    const { sqlite, db } = openReplica();
    const libraryID = upsertGroupLibrary(db, GROUP);
    expect(libraryID).toBe(2);
    expect(findLibraryID(db, { type: "group", groupID: 4603023 })).toBe(2);
    expect(upsertGroupLibrary(db, GROUP)).toBe(2);
    expect(sqlite.prepare("select * from groups").all()).toEqual([
      {
        groupID: 4603023,
        libraryID: 2,
        name: "zoterro testing",
        description: "",
        version: 2,
      },
    ]);

    const result = applyRecords(db, {
      libraryID,
      collections: GOLDEN_COLLECTIONS,
      items: [...GOLDEN_ITEMS].reverse(),
    });
    expect(result).toEqual({
      applied: { collections: ["AZBJE3R8"], items: ["KC6WFG78", "QK48VF5T"] },
      removed: { collections: [], items: [] },
      deferred: [],
      skipped: [],
    });

    expect(fieldsOf(sqlite, libraryID, "KC6WFG78")).toEqual({
      title: "Zotero Web API Documentation",
      abstractNote: "dev:web api:v3:basics",
      websiteTitle: "Zotero Documentation",
      date: "2021-11-05 2021/11/05 05:49",
      citationKey: "ZoteroWebAPI2021",
      url: "https://www.zotero.org/support/dev/web_api/v3/basics",
      accessDate: "2022-02-20 20:28:20",
      language: "en",
    });
    expect(
      sqlite
        .prepare(
          "select itemTypeID, dateAdded, dateModified, clientDateModified, version, synced from items where key = 'KC6WFG78'",
        )
        .get(),
    ).toEqual({
      itemTypeID: 40,
      dateAdded: "2022-02-20 20:28:23",
      dateModified: "2022-03-01 11:37:10",
      clientDateModified: "2022-03-01 11:37:10",
      version: 12,
      synced: 1,
    });
    expect(
      sqlite
        .prepare(
          "select c.collectionName, c.parentCollectionID, c.version, ci.orderIndex from collections c join collectionItems ci using (collectionID)",
        )
        .all(),
    ).toEqual([
      {
        collectionName: "with_robust_links",
        parentCollectionID: null,
        version: 7,
        orderIndex: 0,
      },
    ]);
    expect(
      sqlite
        .prepare(
          "select u.name, g.createdByUserID, g.lastModifiedByUserID from groupItems g join users u on u.userID = g.createdByUserID order by g.itemID",
        )
        .all(),
    ).toEqual([
      {
        name: "Group Member",
        createdByUserID: 1000001,
        lastModifiedByUserID: null,
      },
      {
        name: "Group Member",
        createdByUserID: 1000001,
        lastModifiedByUserID: null,
      },
    ]);

    expect(fieldsOf(sqlite, libraryID, "QK48VF5T")).toEqual({
      title: "Robust Link",
      accessDate: "2022-02-22 16:13:33",
      url: "https://www.zotero.org/support/dev/web_api/v3/basics",
    });
    const attachmentID = findItemID(db, libraryID, "QK48VF5T")!;
    expect(findItemKey(db, attachmentID)).toEqual({
      libraryID,
      key: "QK48VF5T",
    });
    expect(
      sqlite
        .prepare(
          "select parentItemID, linkMode, contentType, charsetID, path, lastRead from itemAttachments where itemID = ?",
        )
        .get(attachmentID),
    ).toEqual({
      parentItemID: findItemID(db, libraryID, "KC6WFG78"),
      linkMode: 3,
      contentType: null,
      charsetID: null,
      path: null,
      lastRead: null,
    });
    const note = sqlite
      .prepare(
        "select parentItemID, note, title from itemNotes where itemID = ?",
      )
      .get(attachmentID) as { parentItemID: null; note: string; title: string };
    expect(note.parentItemID).toBeNull();
    expect(
      note.note.startsWith('<div class="zotero-note znv1">Original URL: <a'),
    ).toBe(true);
    expect(note.note.endsWith("<br></div>")).toBe(true);
    expect(note.title).toBe(
      "Original URL: https://www.zotero.org/support/dev/web_a... Memento URL: https://web.archive.org/web/202202202028...Step 1",
    );
  });
});

describe("records of a real personal library", () => {
  const SANDBOX_ITEMS = sandbox.items as unknown as WebApiItem[];

  it("stores a note, an annotation, attachments and creators of a sandbox library as the Zotero client does", () => {
    const { sqlite, db } = openReplica();
    const result = applyRecords(db, {
      libraryID: 1,
      items: [...SANDBOX_ITEMS].reverse(),
    });
    expect([...result.deferred, ...result.skipped]).toEqual([]);
    expect(result.applied.items.toSorted()).toEqual(
      SANDBOX_ITEMS.map((item) => item.key).toSorted(),
    );
    const id = (key: string) => findItemID(db, 1, key)!;

    expect(
      ["SBX23456", "SBXNPQRS", "SBX45678", "SBXBCDEF", "SBXIJKLM"].map(
        (key) => fieldsOf(sqlite, 1, key).date,
      ),
    ).toEqual([
      "2011-01-00 2011-01",
      "2017-02-15 2017 Feb 15",
      "2011-00-00 2011",
      "2010-00-00 2010",
      "2022-05-31 2022-5-31",
    ]);
    expect(fieldsOf(sqlite, 1, "SBX45678")).toMatchObject({
      bookTitle: "Encyclopedia of operations research and management science",
      extra: "tex.mendeley-tags: invented-topic",
    });
    expect(fieldsOf(sqlite, 1, "SBX23456").pages).toBe("62–89");

    expect(
      sqlite
        .prepare(
          `select i.key, c.firstName, c.lastName, c.fieldMode, t.creatorType, ic.orderIndex
          from itemCreators ic join items i using (itemID) join creators c using (creatorID)
          join creatorTypes t using (creatorTypeID) where i.key in ('SBX23456', 'SBX45678', 'SBXBCDEF')
          order by i.key, ic.orderIndex`,
        )
        .all(),
    ).toEqual([
      {
        key: "SBX23456",
        firstName: "David A.",
        lastName: "Hensher",
        fieldMode: 0,
        creatorType: "author",
        orderIndex: 0,
      },
      {
        key: "SBX23456",
        firstName: "Andrew T.",
        lastName: "Collins",
        fieldMode: 0,
        creatorType: "author",
        orderIndex: 1,
      },
      {
        key: "SBX45678",
        firstName: "G.P.",
        lastName: "Richardson",
        fieldMode: 0,
        creatorType: "author",
        orderIndex: 0,
      },
      {
        key: "SBX45678",
        firstName: "Saul",
        lastName: "Gass",
        fieldMode: 0,
        creatorType: "editor",
        orderIndex: 1,
      },
      {
        key: "SBX45678",
        firstName: "Carl",
        lastName: "Harris",
        fieldMode: 0,
        creatorType: "editor",
        orderIndex: 2,
      },
      {
        key: "SBXBCDEF",
        firstName: "",
        lastName: "ITS",
        fieldMode: 1,
        creatorType: "author",
        orderIndex: 0,
      },
      {
        key: "SBXBCDEF",
        firstName: "P",
        lastName: "Goodwin",
        fieldMode: 0,
        creatorType: "author",
        orderIndex: 1,
      },
      {
        key: "SBXBCDEF",
        firstName: "A",
        lastName: "Last",
        fieldMode: 0,
        creatorType: "author",
        orderIndex: 2,
      },
    ]);

    expect(
      sqlite
        .prepare(
          "select i.key, a.parentItemID, a.linkMode, a.contentType, a.path, a.lastRead from itemAttachments a join items i using (itemID) order by i.key",
        )
        .all(),
    ).toEqual([
      {
        key: "SBX9ABCD",
        parentItemID: id("SBX23456"),
        linkMode: 1,
        contentType: "application/pdf",
        path: "storage:invented-attachment.pdf",
        lastRead: 1700000000,
      },
      {
        key: "SBXQRSTU",
        parentItemID: id("SBXIJKLM"),
        linkMode: 3,
        contentType: "text/html",
        path: null,
        lastRead: null,
      },
    ]);
    expect(fieldsOf(sqlite, 1, "SBXQRSTU").accessDate).toBe(
      "2024-03-01 12:00:00",
    );

    expect(
      sqlite
        .prepare(
          "select type, authorName, text, comment, color, pageLabel, sortIndex, position, isExternal, parentItemID from itemAnnotations",
        )
        .all(),
    ).toEqual([
      {
        type: 1,
        authorName: null,
        text: "The evidence suggests that there is a great deal of behavioural sense in stated choice responses",
        comment: "An invented comment for the fixture.",
        color: "#2ea8e5",
        pageLabel: "63",
        sortIndex: "00001|000846|00267",
        position:
          '{"pageIndex":1,"rects":[[72.5,512.25,523.75,524.5],[72.5,498,301.25,510.25]]}',
        isExternal: 0,
        parentItemID: id("SBX9ABCD"),
      },
    ]);

    expect(
      sqlite
        .prepare("select itemID, parentItemID, note, title from itemNotes")
        .all(),
    ).toEqual([
      {
        itemID: id("SBXVWXYZ"),
        parentItemID: id("SBXNPQRS"),
        note: '<div class="zotero-note znv1"><div data-schema-version="9"><p>Invented note</p>\n</div></div>',
        title: "Invented note",
      },
    ]);
    expect(
      sqlite
        .prepare("select count(*) as tags from itemTags where itemID = ?")
        .get(id("SBXGHIJK")),
    ).toEqual({ tags: 3 });
    expect(
      sqlite
        .prepare(
          "select p.predicate, r.object from itemRelations r join relationPredicates p using (predicateID) order by r.object",
        )
        .all(),
    ).toEqual([
      {
        predicate: "dc:relation",
        object: "http://zotero.org/users/7654321/items/SBXR2345",
      },
      {
        predicate: "dc:relation",
        object: "http://zotero.org/users/7654321/items/SBXR789A",
      },
    ]);
  });

  it("holds no identifier of the sandbox account", () => {
    const text = JSON.stringify(sandbox);
    const libraries = new Set(
      SANDBOX_ITEMS.map((item) => JSON.stringify(item.library)),
    );
    expect([...libraries]).toEqual([
      JSON.stringify({
        type: "user",
        id: 7654321,
        name: "sandbox-reader",
        links: {
          alternate: {
            href: "https://www.zotero.org/sandbox-reader",
            type: "text/html",
          },
        },
      }),
    ]);
    expect(
      SANDBOX_ITEMS.every((item) => /^SBX[2-9A-Z]{5}$/.test(item.key)),
    ).toBe(true);
    const zoteroLinks =
      text.match(/https?:\/\/(?:api\.|www\.)?zotero\.org\/[^"\s<]*/g) ?? [];
    expect(
      zoteroLinks.filter(
        (link) =>
          !/^https?:\/\/(?:api\.|www\.)?zotero\.org\/(?:users\/7654321|sandbox-reader)(?:\/|$)/.test(
            link,
          ),
      ),
    ).toEqual([]);
    const byKey = new Map(SANDBOX_ITEMS.map((item) => [item.key, item.data]));
    expect(byKey.get("SBXGHIJK")).toMatchObject({
      annotationComment: "An invented comment for the fixture.",
      tags: [
        { tag: "invented-tag-1" },
        { tag: "invented-tag-2" },
        { tag: "invented-tag-3" },
      ],
    });
    expect(byKey.get("SBXVWXYZ")?.note).toBe(
      '<div data-schema-version="9"><p>Invented note</p>\n</div>',
    );
    expect(
      SANDBOX_ITEMS.filter((item) => item.data.itemType === "annotation").map(
        (item) => item.data.annotationAuthorName ?? "",
      ),
    ).toEqual([""]);
    expect(
      [...byKey.values()]
        .map((data) => (typeof data.extra === "string" ? data.extra : ""))
        .filter((extra) => extra.startsWith("tex.mendeley-tags:")),
    ).toEqual([
      "tex.mendeley-tags: invented-topic",
      "tex.mendeley-tags: invented-place",
    ]);
    for (const data of byKey.values()) {
      for (const objects of Object.values(data.relations ?? {})) {
        for (const uri of [objects].flat()) {
          expect(uri).toMatch(
            /^http:\/\/zotero\.org\/users\/7654321\/items\/SBX[2-9A-Z]{5}$/,
          );
        }
      }
    }
    const publisherKeywords = new Set([
      "Choice experiments",
      "attribute processing",
      "evidential rules",
      "heuristics",
      "majority of confirming dimensions",
      "plausible choice",
      "reference revision",
      "referencing",
      "sequence effects",
      "value learning",
      "*Heterozygote",
      "*Mutation",
      "Adult-onset nemaline myopathy",
      "Compound heterozygote",
      "Diagnosis, Differential",
      "Disease Progression",
      "Humans",
      "Male",
      "Middle Aged",
      "Muscle Proteins/*genetics",
      "Muscle Weakness/genetics",
      "Myopathies, Nemaline/diagnosis/*genetics/pathology/physiopathology",
      "Nebulin (NEB)",
      "Respiratory Insufficiency/diagnosis/genetics/pathology/physiopathology",
    ]);
    const inventedTags = new Set([
      "invented-tag-1",
      "invented-tag-2",
      "invented-tag-3",
      "invented-tag-4",
      "invented-topic",
      "invented-place",
    ]);
    expect(
      SANDBOX_ITEMS.flatMap((item) => item.data.tags ?? []).filter(
        ({ tag }) => !inventedTags.has(tag) && !publisherKeywords.has(tag),
      ),
    ).toEqual([]);
    const highlight = byKey.get("SBXGHIJK")!;
    expect(highlight).toMatchObject({
      annotationText:
        "The evidence suggests that there is a great deal of behavioural sense in stated choice responses",
      annotationComment: "An invented comment for the fixture.",
      annotationColor: "#2ea8e5",
      annotationPageLabel: "63",
      annotationSortIndex: "00001|000846|00267",
      annotationPosition:
        '{"pageIndex":1,"rects":[[72.5,512.25,523.75,524.5],[72.5,498,301.25,510.25]]}',
    });
    const data = [...byKey.values()];
    expect(
      data.map(({ dateAdded, dateModified }) => [dateAdded, dateModified]),
    ).toEqual(
      data.map((_, index) => [
        `2024-01-0${index + 1}T10:00:00Z`,
        `2024-02-0${index + 1}T10:00:00Z`,
      ]),
    );
    expect(new Set(data.map((entry) => entry.accessDate || null))).toEqual(
      new Set([null, "2024-03-01T12:00:00Z"]),
    );
    expect(
      data.flatMap((entry) =>
        entry.filename === undefined ? [] : [entry.filename],
      ),
    ).toEqual(["invented-attachment.pdf"]);
    expect(
      data.flatMap((entry) => (entry.md5 === undefined ? [] : [entry.md5])),
    ).toEqual(["0".repeat(32)]);
    expect(
      data.flatMap((entry) =>
        entry.lastRead === undefined ? [] : [entry.lastRead],
      ),
    ).toEqual([1700000000]);
    expect(text).not.toMatch(/"(?:createdByUser|lastModifiedByUser|email)"/);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});

describe("applying records", () => {
  it("changes no row when the same records arrive again", () => {
    const { sqlite, db } = openReplica();
    applyScenario(db);
    const first = dump(sqlite);
    expect((first.items as unknown[]).length).toBe(44);
    applyScenario(db);
    expect(dump(sqlite)).toEqual(first);
  });

  it("writes the time of the apply it is given into each time column it fills, so two imports with the same time are equal at any time of day", () => {
    const now = Temporal.Instant.from("2001-02-03T04:05:06.700Z");
    const first = openReplica();
    applyScenario(first.db, false, now);
    const second = openReplica();
    applyScenario(second.db, false, now);
    expect(dump(second.sqlite)).toEqual(dump(first.sqlite));
    const undated = (sqlite: DatabaseSync) => {
      applyRecords(
        connectClient(sqlite),
        {
          libraryID: 1,
          items: [
            {
              key: "UNDATED1",
              version: 1,
              library: { type: "user", id: 1, name: "reader" },
              data: { key: "UNDATED1", version: 1, itemType: "book" },
            },
          ],
        },
        { now },
      );
      return sqlite
        .prepare(
          "select dateAdded, dateModified, clientDateModified from items where key = 'UNDATED1'",
        )
        .get();
    };
    expect(undated(first.sqlite)).toEqual({
      dateAdded: "2001-02-03 04:05:06",
      dateModified: "2001-02-03 04:05:06",
      clientDateModified: "2001-02-03 04:05:06",
    });
    expect(undated(second.sqlite)).toEqual(undated(first.sqlite));
    for (const [table, column] of [
      ["collections", "clientDateModified"],
      ["deletedItems", "dateDeleted"],
      ["deletedCollections", "dateDeleted"],
    ] as const) {
      expect(
        first.sqlite
          .prepare(`select distinct ${column} as time from ${table}`)
          .all(),
      ).toEqual([{ time: "2001-02-03 04:05:06" }]);
    }
  });

  it("reads a two-digit year by the year of the time of the apply when it is given no current year", () => {
    const { sqlite, db } = openReplica();
    applyRecords(
      db,
      {
        libraryID: 1,
        items: [
          {
            key: "BOOK2YR1",
            version: 1,
            library: { type: "user", id: 1, name: "reader" },
            data: {
              key: "BOOK2YR1",
              version: 1,
              itemType: "book",
              date: "02/03/26",
            },
          },
        ],
      },
      { now: Temporal.Instant.from("2001-06-01T00:00:00Z"), timeZone: "UTC" },
    );
    expect(fieldsOf(sqlite, 1, "BOOK2YR1").date).toBe("1926-02-03 02/03/26");
  });

  it("refuses a connection with foreign keys on", () => {
    const { db } = openReplica(true);
    expect(() => applyRecords(db, { libraryID: 1, items: [] })).toThrow(
      "foreign keys off",
    );
  });

  it("derives each date from the date text, not from meta.parsedDate", () => {
    const now = Temporal.Instant.from("2026-01-02T03:04:05Z");
    const withMeta = openReplica();
    applyScenario(withMeta.db, false, now);
    const withoutMeta = openReplica();
    applyScenario(withoutMeta.db, true, now);
    expect(dump(withoutMeta.sqlite)).toEqual(dump(withMeta.sqlite));
    expect(fieldsOf(withoutMeta.sqlite, 1, "BK2MNTH2").date).toBe(
      "2019-11-00 November 2019",
    );
  });

  it("reads a date in the locale it is given, as the client reads it in its own locale", () => {
    const record = (key: string): WebApiItem => ({
      key,
      version: 1,
      library: { type: "user", id: 1, name: "reader" },
      data: { key, version: 1, itemType: "book", date: "01/02/2020 Mai" },
    });
    for (const [locale, multipart] of [
      [undefined, "2020-01-02 01/02/2020 Mai"],
      ["en-GB", "2020-02-01 01/02/2020 Mai"],
    ] as const) {
      const { sqlite, db } = openReplica();
      applyRecords(
        db,
        { libraryID: 1, items: [record("BOOKDATE")] },
        locale === undefined ? {} : { locale },
      );
      expect(fieldsOf(sqlite, 1, "BOOKDATE").date).toBe(multipart);
    }
  });

  it("stores an access date as the fromJSON and setField of the client do, and leaves out a nonzero number, for which the client stores no item", () => {
    const cases = [
      ["2020-01-02", "2020-01-02"],
      ["2020-01-02T03:04:05Z", "2020-01-02 03:04:05"],
      ["2020-01-02T03:04:05.678+01:00", "2020-01-02 02:04:05"],
      ["2020-01-02T03:04Z", "2020-01-02 03:04:00"],
      ["2020-01", "2020-01-01 00:00:00"],
      ["2020", "2020-01-01 00:00:00"],
      ["2020-01-02 03:04:05", undefined],
      ["2020-01-02 03:04:05Z", undefined],
      [" 2020-01-02", undefined],
      ["2020-13-02T03:04:05Z", undefined],
      ["2024-02-29T24:00:00Z", "2024-03-01 00:00:00"],
      ["2024-12-31T24:00Z", "2025-01-01 00:00:00"],
      ["2024-02-29T24:00:00.000+02:00", "2024-02-29 22:00:00"],
      ["2024-02-29T24:00:01Z", undefined],
      ["2024-02-29T24:00:00.5Z", undefined],
      [0, undefined],
      [20200102, undefined],
      ["CURRENT_TIMESTAMP", undefined],
    ] as const;
    const { sqlite, db } = openReplica();
    applyRecords(db, {
      libraryID: 1,
      items: cases.map(([accessDate], index) => {
        const key = `ACCESS${String(index).padStart(2, "0")}`;
        return {
          key,
          version: 1,
          library: { type: "user", id: 1, name: "reader" },
          data: {
            key,
            version: 1,
            itemType: "webpage",
            title: "t",
            accessDate,
          },
        };
      }),
    });
    expect(
      cases.map(
        (_, index) =>
          fieldsOf(sqlite, 1, `ACCESS${String(index).padStart(2, "0")}`)
            .accessDate,
      ),
    ).toEqual(cases.map(([, stored]) => stored));
  });

  it("reads an item date at the end of a day as the start of the next day, as the client's Date does", () => {
    const { sqlite, db } = openReplica();
    applyRecords(db, {
      libraryID: 1,
      items: [
        {
          key: "BOOK2EOD",
          version: 1,
          library: { type: "user", id: 1, name: "reader" },
          data: {
            key: "BOOK2EOD",
            version: 1,
            itemType: "book",
            dateAdded: "2024-02-29T24:00:00Z",
            dateModified: "2024-12-31T24:00:00Z",
          },
        },
      ],
    });
    expect(
      sqlite
        .prepare(
          "select dateAdded, dateModified from items where key = 'BOOK2EOD'",
        )
        .get(),
    ).toEqual({
      dateAdded: "2024-03-01 00:00:00",
      dateModified: "2025-01-01 00:00:00",
    });
  });

  it("reads a local end-of-day hour in the given time zone as the next local midnight, across a daylight-saving gap", () => {
    const { sqlite, db } = openReplica();
    applyRecords(
      db,
      {
        libraryID: 1,
        items: [
          {
            key: "WEB2GAPS",
            version: 1,
            library: { type: "user", id: 1, name: "reader" },
            data: {
              key: "WEB2GAPS",
              version: 1,
              itemType: "webpage",
              accessDate: "2024-09-08T24:00",
              dateAdded: "2024-09-07T24:00:00",
            },
          },
        ],
      },
      { timeZone: "America/Santiago" },
    );
    expect(fieldsOf(sqlite, 1, "WEB2GAPS").accessDate).toBe(
      "2024-09-09 03:00:00",
    );
    expect(
      sqlite
        .prepare("select dateAdded from items where key = 'WEB2GAPS'")
        .get(),
    ).toEqual({ dateAdded: "2024-09-08 04:00:00" });
  });

  it("shares one value, creator and tag row between items", () => {
    const { sqlite, db } = openReplica();
    applyScenario(db);
    const count = (query: string) =>
      (sqlite.prepare(query).get() as { n: number }).n;
    expect(
      count(
        "select count(*) as n from itemDataValues where value = 'Journal of Testing'",
      ),
    ).toBe(1);
    expect(
      count(
        "select count(*) as n from itemData d join itemDataValues v using (valueID) where v.value = 'Journal of Testing'",
      ),
    ).toBe(2);
    expect(
      count("select count(*) as n from creators where lastName = 'Lovelace'"),
    ).toBe(1);
    expect(
      count(
        "select count(*) as n from itemCreators join creators using (creatorID) where lastName = 'Lovelace'",
      ),
    ).toBe(3);
    expect(count("select count(*) as n from tags where name = 'to-read'")).toBe(
      1,
    );
    expect(
      sqlite
        .prepare(
          "select firstName, lastName, fieldMode from creators where lastName = 'World Health Organization'",
        )
        .all(),
    ).toEqual([
      { firstName: "", lastName: "World Health Organization", fieldMode: 1 },
    ]);
  });

  it("stores field, creator and tag text with the UTF-8 encoding of a bound string", () => {
    const { db, sqlite } = openReplica();
    const text = "Record📚\ud800";
    const article = GOLDEN_ITEMS[0]!;
    applyRecords(db, {
      libraryID: 1,
      items: [
        {
          ...article,
          data: {
            ...article.data,
            title: text,
            collections: [],
            creators: [{ creatorType: "author", name: text }],
            tags: [{ tag: text }],
          },
        },
      ],
    });
    expect(
      sqlite
        .prepare(`select
      (select hex(value) from itemDataValues where value like 'Record%') as field,
      (select hex(lastName) from creators) as creator, (select hex(name) from tags) as tag`)
        .get(),
    ).toEqual(
      sqlite
        .prepare("select hex(?) as field, hex(?) as creator, hex(?) as tag")
        .get(text, text, text),
    );
  });

  it("keeps collection positions when one update adds, removes and restores members in order", () => {
    const { db, sqlite } = openReplica();
    const collection = GOLDEN_COLLECTIONS[0]!;
    const article = GOLDEN_ITEMS[0]!;
    const member = (key: string, joined: boolean): WebApiItem => ({
      ...article,
      key,
      data: {
        ...article.data,
        key,
        collections: joined ? [collection.key] : [],
      },
    });
    applyRecords(db, {
      libraryID: 1,
      collections: [collection],
      items: [member("MEMBER2A", true), member("MEMBER2B", true)],
    });
    applyRecords(db, {
      libraryID: 1,
      items: [
        member("MEMBER2C", true),
        member("MEMBER2B", false),
        member("MEMBER2D", true),
        member("MEMBER2B", true),
      ],
    });
    expect(
      sqlite
        .prepare(`select key, orderIndex from collectionItems join items using (itemID)
      order by orderIndex`)
        .all(),
    ).toEqual([
      { key: "MEMBER2A", orderIndex: 0 },
      { key: "MEMBER2C", orderIndex: 2 },
      { key: "MEMBER2D", orderIndex: 3 },
      { key: "MEMBER2B", orderIndex: 4 },
    ]);
  });

  it("replaces the rows of an item when a newer version arrives", () => {
    const { sqlite, db } = openReplica();
    applyScenario(db);
    const [personal] = scenarioRecords();
    const article = personal!.items.find((item) => item.key === "ART2FULL")!;
    const itemID = findItemID(db, 1, "ART2FULL")!;
    const data: WebApiItemData = {
      ...article.data,
      version: 99,
      title: "Revised Title",
      date: "March 2021",
      volume: "",
      creators: [
        { creatorType: "editor", firstName: "Ada", lastName: "Lovelace" },
      ],
      tags: [{ tag: "methods" }, { tag: "revised", type: 1 }],
      collections: ["CL2THSIS"],
      relations: {},
    };
    const result = applyRecords(db, {
      libraryID: 1,
      items: [{ ...article, version: 99, data }],
    });
    expect(result.applied.items).toEqual(["ART2FULL"]);
    expect(findItemID(db, 1, "ART2FULL")).toBe(itemID);

    expect(fieldsOf(sqlite, 1, "ART2FULL")).toEqual({
      title: "Revised Title",
      date: "2021-03-00 March 2021",
      publicationTitle: "Journal of Testing",
      DOI: "10.1234/exact",
    });
    expect(
      sqlite
        .prepare(
          "select c.lastName, t.creatorType, ic.orderIndex from itemCreators ic join creators c using (creatorID) join creatorTypes t using (creatorTypeID) where ic.itemID = ?",
        )
        .all(itemID),
    ).toEqual([{ lastName: "Lovelace", creatorType: "editor", orderIndex: 0 }]);
    expect(
      sqlite
        .prepare(
          "select t.name, it.type from itemTags it join tags t using (tagID) where it.itemID = ? order by t.name",
        )
        .all(itemID),
    ).toEqual([
      { name: "methods", type: 0 },
      { name: "revised", type: 1 },
    ]);
    expect(
      sqlite
        .prepare(
          "select c.key from collectionItems ci join collections c using (collectionID) where ci.itemID = ?",
        )
        .all(itemID),
    ).toEqual([{ key: "CL2THSIS" }]);
    const exists = (query: string) => sqlite.prepare(query).get() !== undefined;
    expect(
      exists(
        "select 1 from itemDataValues where value = 'Exact Matching in Literature Review'",
      ),
    ).toBe(false);
    expect(
      exists(
        "select 1 from creators where lastName = 'World Health Organization'",
      ),
    ).toBe(false);
    expect(exists("select 1 from tags where name = 'To-Read'")).toBe(false);
    expect(exists("select 1 from tags where name = 'to-read'")).toBe(true);
  });

  it("removes a deleted item with its child items and unused rows", () => {
    const { sqlite, db } = openReplica();
    applyScenario(db);
    const result = applyRecords(db, {
      libraryID: 1,
      deleted: { items: ["ART2FULL", "NOT2HERE"], collections: ["CL2THSIS"] },
    });
    expect(result.removed).toEqual({
      items: ["ART2FULL"],
      collections: ["CL2THSIS"],
    });
    const keys = (
      sqlite.prepare("select key from items where libraryID = 1").all() as {
        key: string;
      }[]
    ).map((row) => row.key);
    for (const key of [
      "ART2FULL",
      "PDF2LIVE",
      "ANN2HGHT",
      "NTE2CHLD",
      "PDF2CHLD",
      "IMG2EMBD",
      "ANN2LINK",
    ]) {
      expect(keys).not.toContain(key);
    }
    expect(keys).toContain("BK2MNTH2");
    for (const table of [
      "itemData",
      "itemCreators",
      "itemTags",
      "itemNotes",
      "itemAttachments",
      "itemAnnotations",
      "collectionItems",
      "itemRelations",
      "deletedItems",
    ]) {
      expect(
        sqlite
          .prepare(
            `select count(*) as n from ${table} where itemID not in (select itemID from items)`,
          )
          .get(),
        table,
      ).toEqual({ n: 0 });
    }
    expect(
      (
        sqlite
          .prepare(
            "select key from collections where libraryID = 1 order by key",
          )
          .all() as { key: string }[]
      ).map((row) => row.key),
    ).toEqual(["CL2ARCHV", "CL2ARLD2", "CL2TCHNG", "CL2TCMTH"]);
    expect(
      sqlite
        .prepare(
          "select 1 from creators where lastName = 'World Health Organization'",
        )
        .get(),
    ).toBeUndefined();
    expect(
      sqlite
        .prepare("select 1 from creators where lastName = 'Lovelace'")
        .get(),
    ).toBeDefined();
  });

  it("stores children that arrive before their parent and defers those whose parent is missing", () => {
    const { db } = openReplica();
    const [parent, child] = GOLDEN_ITEMS;
    const orphan: WebApiItem = {
      ...child!,
      key: "ORPH2AN2",
      data: { ...child!.data, key: "ORPH2AN2", parentItem: "GONE2KEY" },
    };
    const result = applyRecords(db, {
      libraryID: upsertGroupLibrary(db, GROUP),
      collections: GOLDEN_COLLECTIONS,
      items: [orphan, child!, parent!],
    });
    expect(result.applied.items).toEqual(["KC6WFG78", "QK48VF5T"]);
    expect(result.deferred).toEqual([
      {
        objectType: "item",
        key: "ORPH2AN2",
        reason: "missingParent",
        detail: "parent item GONE2KEY is not stored",
      },
    ]);
  });

  it("skips and logs an unknown item type, and stores an item without its unknown field", () => {
    const logs: LibraryLogRecord[] = [];
    setLibraryLogSink((record) => logs.push(record));
    const { sqlite, db } = openReplica();
    const libraryID = upsertGroupLibrary(db, GROUP);
    const [webpage] = GOLDEN_ITEMS;
    const future: WebApiItem = {
      ...webpage!,
      key: "FUTR2TYP",
      data: {
        ...webpage!.data,
        key: "FUTR2TYP",
        itemType: "hologram",
        collections: [],
      },
    };
    const extended: WebApiItem = {
      ...webpage!,
      data: {
        ...webpage!.data,
        collections: [],
        futureField: "from a newer schema",
      },
    };
    const result = applyRecords(db, { libraryID, items: [future, extended] });
    expect(result.skipped).toEqual([
      {
        objectType: "item",
        key: "FUTR2TYP",
        reason: "unknownItemType",
        detail: "unknown item type hologram",
      },
    ]);
    expect(result.applied.items).toEqual(["KC6WFG78"]);
    expect(fieldsOf(sqlite, libraryID, "KC6WFG78").title).toBe(
      "Zotero Web API Documentation",
    );
    expect(
      logs.map(({ level, properties }) => ({ level, properties })),
    ).toEqual([
      { level: "warn", properties: { key: "FUTR2TYP", itemType: "hologram" } },
      {
        level: "warn",
        properties: {
          key: "KC6WFG78",
          field: "futureField",
          reason: "the Zotero schema of this version has no such field",
        },
      },
    ]);
  });

  it("stores a book without a field that the vendored schema lacks, and leaves its Extra as sent", () => {
    const logs: LibraryLogRecord[] = [];
    setLibraryLogSink((record) => logs.push(record));
    const { sqlite, db } = openReplica();
    const result = applyRecords(db, {
      libraryID: 1,
      items: [
        {
          key: "BOOK2FUT",
          version: 1,
          library: { type: "user", id: 1, name: "reader" },
          data: {
            key: "BOOK2FUT",
            version: 1,
            itemType: "book",
            title: "Kept",
            extra: "Note: kept",
            futureField: "x",
          },
        },
      ],
    });
    expect(result.applied.items).toEqual(["BOOK2FUT"]);
    expect(result.skipped).toEqual([]);
    expect(result.deferred).toEqual([]);
    expect(fieldsOf(sqlite, 1, "BOOK2FUT")).toEqual({
      title: "Kept",
      extra: "Note: kept",
    });
    expect(logs.map(({ properties }) => properties)).toEqual([
      {
        key: "BOOK2FUT",
        field: "futureField",
        reason: "the Zotero schema of this version has no such field",
      },
    ]);
  });

  it("stores what a reader can use from a record that the strict sync of the client rejects", () => {
    const logs: LibraryLogRecord[] = [];
    setLibraryLogSink((record) => logs.push(record));
    const { sqlite, db } = openReplica();
    const base = {
      version: 1,
      library: { type: "user", id: 1, name: "reader" },
    } as const;
    const result = applyRecords(db, {
      libraryID: 1,
      items: [
        {
          ...base,
          key: "BOOK2MAP",
          data: {
            key: "BOOK2MAP",
            version: 1,
            itemType: "book",
            title: "Atlas",
            creators: [
              {
                creatorType: "cartographer",
                firstName: "Ada",
                lastName: "Lovelace",
              },
            ],
          },
        },
        {
          ...base,
          key: "PDF2NOTE",
          data: {
            key: "PDF2NOTE",
            version: 1,
            itemType: "attachment",
            linkMode: "imported_file",
            filename: "a.pdf",
          },
        },
        {
          ...base,
          key: "NOTE2TXT",
          data: {
            key: "NOTE2TXT",
            version: 1,
            itemType: "annotation",
            parentItem: "PDF2NOTE",
            annotationType: "note",
            annotationText: "Body",
            annotationComment: "Comment",
            annotationSortIndex: "00000|000000|00000",
            annotationPosition: "{}",
          },
        },
      ],
    });
    expect([...result.deferred, ...result.skipped]).toEqual([]);
    expect(
      sqlite
        .prepare(
          `select t.creatorType, c.firstName, c.lastName from itemCreators join creators c using (creatorID)
          join creatorTypes t using (creatorTypeID)`,
        )
        .all(),
    ).toEqual([
      { creatorType: "author", firstName: "Ada", lastName: "Lovelace" },
    ]);
    expect(
      sqlite.prepare("select type, text, comment from itemAnnotations").all(),
    ).toEqual([{ type: 2, text: null, comment: "Comment" }]);
    expect(logs.map(({ properties }) => properties)).toEqual([
      { key: "BOOK2MAP", creatorType: "cartographer", itemType: "book" },
    ]);
  });

  it("stores the other records that the strict sync of the client rejects", () => {
    const { sqlite, db } = openReplica();
    const library = { type: "user", id: 1, name: "reader" } as const;
    const result = applyRecords(db, {
      libraryID: 1,
      collections: [
        {
          key: "COLL2EMP",
          version: 1,
          library,
          data: {
            key: "COLL2EMP",
            version: 1,
            name: "",
            parentCollection: false,
            relations: {},
          },
        },
      ],
      items: [
        {
          key: "BOOK2FST",
          version: 1,
          library,
          data: {
            key: "BOOK2FST",
            version: 1,
            itemType: "book",
            dateAdded: "2024-02-30T00:00:00Z",
            creators: [{ creatorType: "author", firstName: "Ada" } as never],
          },
        },
        {
          key: "PDF2COLR",
          version: 1,
          library,
          data: {
            key: "PDF2COLR",
            version: 1,
            itemType: "attachment",
            linkMode: "imported_file",
            filename: "a.pdf",
          },
        },
        {
          key: "ANN2COLR",
          version: 1,
          library,
          data: {
            key: "ANN2COLR",
            version: 1,
            itemType: "annotation",
            parentItem: "PDF2COLR",
            annotationType: "highlight",
            annotationText: "Text",
            annotationColor: "red",
            annotationSortIndex: "not a sort index",
            annotationPosition: "{}",
          },
        },
      ],
    });
    expect([...result.deferred, ...result.skipped]).toEqual([]);
    expect(
      sqlite.prepare("select collectionName from collections").all(),
    ).toEqual([{ collectionName: "" }]);
    expect(
      sqlite
        .prepare(
          "select c.firstName, c.lastName, c.fieldMode from itemCreators join creators c using (creatorID)",
        )
        .all(),
    ).toEqual([{ firstName: "Ada", lastName: "", fieldMode: 0 }]);
    const added = sqlite
      .prepare("select dateAdded from items where key = 'BOOK2FST'")
      .get() as { dateAdded: string };
    expect(added.dateAdded).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    expect(added.dateAdded).not.toBe("2024-02-30 00:00:00");
    expect(
      sqlite.prepare("select color, sortIndex from itemAnnotations").all(),
    ).toEqual([{ color: "red", sortIndex: "not a sort index" }]);
  });

  it("leaves out a field the item type lacks and an invalid value, and keeps a creator without a name as the client does", () => {
    const logs: LibraryLogRecord[] = [];
    setLibraryLogSink((record) => logs.push(record));
    const { sqlite, db } = openReplica();
    const result = applyRecords(db, {
      libraryID: 1,
      items: [
        {
          key: "BOOK2BAD",
          version: 1,
          library: { type: "user", id: 1, name: "reader" },
          data: {
            key: "BOOK2BAD",
            version: 1,
            itemType: "book",
            title: "Kept",
            websiteTitle: "Not a book field",
            accessDate: "yesterday",
            pages: { from: 1 },
            creators: [
              { creatorType: "author", firstName: " ", lastName: "" },
              { creatorType: "author", name: "Kept" },
            ],
          },
        },
      ],
    });
    expect(result.applied.items).toEqual(["BOOK2BAD"]);
    expect(fieldsOf(sqlite, 1, "BOOK2BAD")).toEqual({ title: "Kept" });
    expect(
      sqlite
        .prepare(
          "select lastName, orderIndex from itemCreators join creators using (creatorID)",
        )
        .all(),
    ).toEqual([
      { lastName: "", orderIndex: 0 },
      { lastName: "Kept", orderIndex: 1 },
    ]);
    expect(
      logs.map(({ properties }) => properties.reason ?? properties.field),
    ).toEqual([
      "not a field of item type book",
      "invalid access date yesterday",
      "a object is not a field value",
    ]);
  });

  it("skips an annotation of an unknown type and an attachment of an unknown link mode", () => {
    const { sqlite, db } = openReplica();
    const base = {
      version: 1,
      library: { type: "user", id: 1, name: "reader" },
    } as const;
    const result = applyRecords(db, {
      libraryID: 1,
      items: [
        {
          ...base,
          key: "FUTR2LNK",
          data: {
            key: "FUTR2LNK",
            version: 1,
            itemType: "attachment",
            linkMode: "hologram" as never,
          },
        },
        {
          ...base,
          key: "FUTR2ANN",
          data: {
            key: "FUTR2ANN",
            version: 1,
            itemType: "annotation",
            annotationType: "hologram" as never,
          },
        },
      ],
    });
    expect(result.skipped).toEqual([
      {
        objectType: "item",
        key: "FUTR2LNK",
        reason: "unknownLinkMode",
        detail: "unknown link mode hologram",
      },
      {
        objectType: "item",
        key: "FUTR2ANN",
        reason: "unknownAnnotationType",
        detail: "unknown annotation type hologram",
      },
    ]);
    expect(sqlite.prepare("select count(*) as n from items").get()).toEqual({
      n: 0,
    });
  });

  it("writes no read time when an update of a personal attachment brings one that is not an integer, where the client keeps the old one (a known difference of @zotlit/zotero-compat)", () => {
    const { sqlite, db } = openReplica();
    const attachment = (version: number, lastRead: unknown): WebApiItem => ({
      key: "PDF2SOON",
      version,
      library: { type: "user", id: 1, name: "reader" },
      data: {
        key: "PDF2SOON",
        version,
        itemType: "attachment",
        linkMode: "imported_file",
        filename: "paper.pdf",
        contentType: "application/pdf",
        lastRead: lastRead as number,
      },
    });
    const stored = () =>
      sqlite
        .prepare(
          "select lastRead from itemAttachments join items using (itemID) where key = 'PDF2SOON'",
        )
        .get();
    applyRecords(db, { libraryID: 1, items: [attachment(1, 123)] });
    expect(stored()).toEqual({ lastRead: 123 });
    applyRecords(db, { libraryID: 1, items: [attachment(2, "soon")] });
    expect(stored()).toEqual({ lastRead: null });
  });

  it("stores the canonical character set of an attachment, as the client's attachmentCharset setter does, and none for a label the client does not know", () => {
    const { sqlite, db } = openReplica();
    const attachment = (key: string, charset: string): WebApiItem => ({
      key,
      version: 1,
      library: { type: "user", id: 1, name: "reader" },
      data: {
        key,
        version: 1,
        itemType: "attachment",
        linkMode: "imported_url",
        filename: "page.html",
        contentType: "text/html",
        charset,
      },
    });
    applyRecords(db, {
      libraryID: 1,
      items: [
        attachment("CHARSET1", " Latin1 "),
        attachment("CHARSET2", "UTF8"),
        attachment("CHARSET3", "big5-hkscs"),
        attachment("CHARSET4", "made-up"),
      ],
    });
    expect(
      sqlite
        .prepare(
          `select i.key, c.charset from itemAttachments a join items i using (itemID)
            left join charsets c using (charsetID) order by i.key`,
        )
        .all(),
    ).toEqual([
      { key: "CHARSET1", charset: "windows-1252" },
      { key: "CHARSET2", charset: "utf-8" },
      { key: "CHARSET3", charset: null },
      { key: "CHARSET4", charset: null },
    ]);
  });

  it("throws on a creator name or a collection name that is a number, as the importer did before the rules moved", () => {
    const { db } = openReplica();
    expect(() =>
      applyRecords(db, {
        libraryID: 1,
        collections: [
          {
            key: "COLLNUM1",
            version: 1,
            library: { type: "user", id: 1, name: "reader" },
            data: {
              key: "COLLNUM1",
              version: 1,
              name: 5 as unknown as string,
              parentCollection: false,
            },
          },
        ],
      }),
    ).toThrow(TypeError);
    expect(() =>
      applyRecords(db, {
        libraryID: 1,
        items: [
          {
            key: "BOOK2NUM",
            version: 1,
            library: { type: "user", id: 1, name: "reader" },
            data: {
              key: "BOOK2NUM",
              version: 1,
              itemType: "book",
              creators: [
                { creatorType: "author", name: 5 as unknown as string },
              ],
            },
          },
        ],
      }),
    ).toThrow(TypeError);
  });

  it("keeps lastRead in the personal library only, and the annotation author", () => {
    const { sqlite, db } = openReplica();
    const [parent, link] = GOLDEN_ITEMS;
    const pdf: WebApiItem = {
      ...link!,
      key: "PDF2READ",
      data: {
        ...link!.data,
        key: "PDF2READ",
        linkMode: "imported_file",
        filename: "paper.pdf",
        contentType: "application/pdf",
        note: "",
        lastRead: 1700000000,
      },
    };
    const annotation: WebApiItem = {
      ...link!,
      key: "ANN2AUTH",
      data: {
        key: "ANN2AUTH",
        version: 9,
        itemType: "annotation",
        parentItem: "PDF2READ",
        annotationType: "highlight",
        annotationAuthorName: " Reader Two ",
        annotationText: "quoted",
        annotationComment: "",
        annotationColor: "",
        annotationPageLabel: "3",
        annotationSortIndex: "00002|000100|00050",
        annotationPosition: ' {"pageIndex":2,"rects":[[1,2,3,4]]}',
        tags: [],
        relations: {},
        dateAdded: "2024-01-01T00:00:00Z",
        dateModified: "2024-01-01T00:00:00Z",
      },
    };
    const personal = { ...parent!, data: { ...parent!.data, collections: [] } };
    applyRecords(db, { libraryID: 1, items: [personal, pdf, annotation] });
    const groupID = upsertGroupLibrary(db, GROUP);
    applyRecords(db, { libraryID: groupID, items: [personal, pdf] });
    expect(
      sqlite
        .prepare(
          "select i.libraryID, a.linkMode, a.path, a.lastRead from itemAttachments a join items i using (itemID) where i.key = 'PDF2READ' order by i.libraryID",
        )
        .all(),
    ).toEqual([
      {
        libraryID: 1,
        linkMode: 0,
        path: "storage:paper.pdf",
        lastRead: 1700000000,
      },
      {
        libraryID: groupID,
        linkMode: 0,
        path: "storage:paper.pdf",
        lastRead: null,
      },
    ]);
    expect(
      sqlite
        .prepare(
          "select type, authorName, text, comment, color, pageLabel, sortIndex, position, isExternal from itemAnnotations",
        )
        .get(),
    ).toEqual({
      type: 1,
      authorName: "Reader Two",
      text: "quoted",
      comment: null,
      color: "#ffd400",
      pageLabel: "3",
      sortIndex: "00002|000100|00050",
      position: ' {"pageIndex":2,"rects":[[1,2,3,4]]}',
      isExternal: 0,
    });
  });

  it("runs no correlated subquery that scans a table, so a purge reads each table once and probes the rest through an index", () => {
    const { sqlite, db } = openReplica();
    applyScenario(db);
    const statements = new Set<string>();
    const prepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (source: string) => {
      statements.add(source);
      return prepare(source);
    };
    applyScenario(db);
    applyRecords(db, {
      libraryID: 1,
      deleted: { items: ["ART2FULL"], collections: ["CL2THSIS"] },
    });
    sqlite.prepare = prepare;
    const purges = [...statements].filter((source) =>
      /^delete from (itemDataValues|creators|tags) /.test(source),
    );
    expect(purges.length).toBe(3);
    const correlatedScans = [...statements].filter((source) => {
      const plan = prepare(`explain query plan ${source}`).all() as {
        id: number;
        parent: number;
        detail: string;
      }[];
      const inCorrelated = (row: (typeof plan)[number]): boolean => {
        const parent = plan.find((step) => step.id === row.parent);
        if (!parent) return false;
        return parent.detail.includes("CORRELATED") || inCorrelated(parent);
      };
      return plan.some(
        (row) =>
          row.detail.startsWith("SCAN ") &&
          !row.detail.includes("VIRTUAL TABLE") &&
          inCorrelated(row),
      );
    });
    expect(correlatedScans).toEqual([]);
  });
});
