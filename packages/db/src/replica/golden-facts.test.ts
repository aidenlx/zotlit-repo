import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";

import type {
  WebApiCollection,
  WebApiItem,
  WebApiItemData,
} from "@zotlit/zotero-types/web-api";

import { applyRecords } from "./apply.ts";
import { createReplica } from "./create.ts";

import { connectClient } from "#desktop/node-client.ts";

const LIBRARY = { type: "user", id: 7654321, name: "reader" } as const;
const ADDED = "2024-01-02T03:04:05Z";

function record(
  data: Partial<WebApiItemData> & Pick<WebApiItemData, "key" | "itemType">,
): WebApiItem {
  return {
    key: data.key,
    version: 5,
    library: LIBRARY,
    data: { version: 5, dateAdded: ADDED, dateModified: ADDED, ...data },
  };
}

const COLLECTIONS: WebApiCollection[] = [
  {
    key: "COLL0001",
    version: 5,
    library: LIBRARY,
    data: {
      key: "COLL0001",
      version: 5,
      name: " Reading Cafe\u0301 ",
      parentCollection: false,
      relations: {},
    },
  },
];

const POSITION = '{"pageIndex":0,"rects":[[1,2,3,4]]} ';

const ITEMS: WebApiItem[] = [
  record({
    key: "BOOK0001",
    itemType: "book",
    title: "Parent",
    ISBN: "9780306406157",
    creators: [
      { creatorType: "author", name: " WHO " },
      { creatorType: "editor", firstName: " Ada ", lastName: "Lovelace" },
      { creatorType: "author", name: "Ada Lovelace" },
    ],
    tags: [
      { tag: " To-Read " },
      { tag: "to-read", type: 1 },
      { tag: "Café" },
      { tag: "dup" },
      { tag: "dup", type: 1 },
      { tag: "last", type: 1 },
      { tag: "last" },
    ],
  }),
  record({
    key: "BOOK0002",
    itemType: "journalArticle",
    title: "Second",
    creators: [{ creatorType: "author", name: "WHO" }],
  }),
  record({
    key: "NOTE0001",
    itemType: "note",
    parentItem: "BOOK0001",
    note: "\u0007<p>A &amp; B</p>\n<p>C</p> ",
  }),
  record({
    key: "NOTE0002",
    itemType: "note",
    note: "",
    collections: ["COLL0001"],
  }),
  record({
    key: "NOTE0003",
    itemType: "note",
    parentItem: "BOOK0001",
    note: '<div class="zotero-note znv2"><p>Kept</p></div>',
  }),
  record({
    key: "ATTFILE1",
    itemType: "attachment",
    parentItem: "BOOK0001",
    linkMode: "imported_file",
    title: "a.pdf",
    contentType: "application/pdf",
    charset: "utf-8",
    filename: "a.pdf",
    note: "",
  }),
  record({
    key: "ATTURL01",
    itemType: "attachment",
    parentItem: "BOOK0001",
    linkMode: "imported_url",
    title: "Snapshot",
    contentType: "",
    charset: "",
    filename: "b.html",
    note: "<p>Snap</p>",
  }),
  record({
    key: "ATTLINK1",
    itemType: "attachment",
    parentItem: "BOOK0001",
    linkMode: "linked_file",
    title: "x",
    contentType: "application/pdf",
    charset: "",
    path: "attachments:x/a.pdf",
    note: "",
  }),
  record({
    key: "ATTLINK2",
    itemType: "attachment",
    parentItem: "BOOK0001",
    linkMode: "linked_file",
    title: "y",
    contentType: "",
    charset: "",
    path: "/home/reader/y.pdf",
    note: "",
  }),
  record({
    key: "ATTLURL1",
    itemType: "attachment",
    parentItem: "BOOK0001",
    linkMode: "linked_url",
    title: "Link",
    url: "https://example.org/",
    contentType: "",
    charset: "",
    note: "",
  }),
  record({
    key: "ATTIMG01",
    itemType: "attachment",
    parentItem: "NOTE0001",
    linkMode: "embedded_image",
    contentType: "image/png",
    filename: "image.png",
  }),
  record({
    key: "ANNHIGH1",
    itemType: "annotation",
    parentItem: "ATTFILE1",
    annotationType: "highlight",
    annotationAuthorName: "",
    annotationText: " Hi Cafe\u0301 ",
    annotationComment: " c ",
    annotationColor: "",
    annotationPageLabel: " 1 ",
    annotationSortIndex: "00000|000000|00000",
    annotationPosition: POSITION,
  }),
  ...(
    [
      ["ANNNOTE1", "note"],
      ["ANNIMAG1", "image"],
      ["ANNINK01", "ink"],
      ["ANNUNDR1", "underline"],
      ["ANNTEXT1", "text"],
    ] as const
  ).map(([key, annotationType]) =>
    record({
      key,
      itemType: "annotation",
      parentItem: "ATTFILE1",
      annotationType,
      annotationAuthorName: "Ada",
      ...(annotationType === "underline" ? { annotationText: "Body" } : {}),
      annotationComment: "",
      annotationColor: "#5fb236",
      annotationPageLabel: "2",
      annotationSortIndex: "00001|000000|00000",
      annotationPosition: POSITION,
    }),
  ),
];

describe("hand-written Web API records give the rows the Zotero client stores", () => {
  let sqlite: DatabaseSync;
  const rows = (query: string, ...keys: string[]) =>
    sqlite.prepare(query).all(...keys);
  const id = (key: string) =>
    (
      sqlite.prepare("select itemID from items where key = ?").get(key) as {
        itemID: number;
      }
    ).itemID;

  beforeAll(() => {
    sqlite = new DatabaseSync(":memory:", {
      enableForeignKeyConstraints: false,
    });
    const db = connectClient(sqlite);
    createReplica(db);
    const result = applyRecords(db, {
      libraryID: 1,
      collections: COLLECTIONS,
      items: ITEMS,
    });
    expect([...result.deferred, ...result.skipped]).toEqual([]);
  });

  it("stores a note cleaned, trimmed and wrapped, with its title and parent", () => {
    expect(
      rows(
        "select parentItemID, note, title from itemNotes where itemID = ?",
        String(id("NOTE0001")),
      ),
    ).toEqual([
      {
        parentItemID: id("BOOK0001"),
        note: '<div class="zotero-note znv1"><p>A &amp; B</p>\n<p>C</p></div>',
        title: "A & B",
      },
    ]);
    expect(
      rows(
        "select note, title from itemNotes where itemID = ?",
        String(id("NOTE0003")),
      ),
    ).toEqual([
      {
        note: '<div class="zotero-note znv2"><p>Kept</p></div>',
        title: "Kept",
      },
    ]);
  });

  it("stores an empty top-level note as the wrapper only, without a title field, in its collection", () => {
    const itemID = id("NOTE0002");
    expect(
      rows(
        "select parentItemID, note, title from itemNotes where itemID = ?",
        String(itemID),
      ),
    ).toEqual([
      {
        parentItemID: null,
        note: '<div class="zotero-note znv1"></div>',
        title: "",
      },
    ]);
    expect(
      rows("select * from itemData where itemID = ?", String(itemID)),
    ).toEqual([]);
    expect(
      rows(
        "select c.key from collectionItems join collections c using (collectionID) where itemID = ?",
        String(itemID),
      ),
    ).toEqual([{ key: "COLL0001" }]);
  });

  it("gives an attachment note no parent and an empty attachment note no row", () => {
    expect(
      rows(
        "select i.key, n.parentItemID, n.note, n.title from itemNotes n join items i using (itemID) where i.itemTypeID = (select itemTypeID from itemTypes where typeName = 'attachment')",
      ),
    ).toEqual([
      {
        key: "ATTURL01",
        parentItemID: null,
        note: '<div class="zotero-note znv1"><p>Snap</p></div>',
        title: "Snap",
      },
    ]);
  });

  it("stores the attachment rows of each link mode", () => {
    expect(
      rows(
        `select i.key, a.parentItemID, a.linkMode, a.contentType, c.charset, a.path
        from itemAttachments a join items i using (itemID) left join charsets c using (charsetID)
        order by i.key`,
      ),
    ).toEqual([
      {
        key: "ATTFILE1",
        parentItemID: id("BOOK0001"),
        linkMode: 0,
        contentType: "application/pdf",
        charset: "utf-8",
        path: "storage:a.pdf",
      },
      {
        key: "ATTIMG01",
        parentItemID: id("NOTE0001"),
        linkMode: 4,
        contentType: "image/png",
        charset: null,
        path: "storage:image.png",
      },
      {
        key: "ATTLINK1",
        parentItemID: id("BOOK0001"),
        linkMode: 2,
        contentType: "application/pdf",
        charset: null,
        path: "attachments:x/a.pdf",
      },
      {
        key: "ATTLINK2",
        parentItemID: id("BOOK0001"),
        linkMode: 2,
        contentType: null,
        charset: null,
        path: "/home/reader/y.pdf",
      },
      {
        key: "ATTLURL1",
        parentItemID: id("BOOK0001"),
        linkMode: 3,
        contentType: null,
        charset: null,
        path: null,
      },
      {
        key: "ATTURL01",
        parentItemID: id("BOOK0001"),
        linkMode: 1,
        contentType: null,
        charset: null,
        path: "storage:b.html",
      },
    ]);
  });

  it("stores the annotation rows, with text only on a highlight or an underline", () => {
    const parentItemID = id("ATTFILE1");
    const other = {
      parentItemID,
      authorName: "Ada",
      comment: null,
      color: "#5fb236",
      pageLabel: "2",
      sortIndex: "00001|000000|00000",
      position: POSITION,
      isExternal: 0,
    };
    expect(
      rows(
        `select i.key, a.parentItemID, a.type, a.authorName, a.text, a.comment, a.color,
          a.pageLabel, a.sortIndex, a.position, a.isExternal
        from itemAnnotations a join items i using (itemID) order by a.type`,
      ),
    ).toEqual([
      {
        key: "ANNHIGH1",
        parentItemID,
        type: 1,
        authorName: null,
        text: "Hi Caf\u00e9",
        comment: "c",
        color: "#ffd400",
        pageLabel: "1",
        sortIndex: "00000|000000|00000",
        position: POSITION,
        isExternal: 0,
      },
      { key: "ANNNOTE1", type: 2, text: null, ...other },
      { key: "ANNIMAG1", type: 3, text: null, ...other },
      { key: "ANNINK01", type: 4, text: null, ...other },
      { key: "ANNUNDR1", type: 5, text: "Body", ...other },
      { key: "ANNTEXT1", type: 6, text: null, ...other },
    ]);
  });

  it("stores trimmed creators by position and shares a creator between items", () => {
    expect(
      rows(
        `select i.key, c.firstName, c.lastName, c.fieldMode, t.creatorType, ic.orderIndex
        from itemCreators ic join items i using (itemID) join creators c using (creatorID)
        join creatorTypes t using (creatorTypeID) order by i.key, ic.orderIndex`,
      ),
    ).toEqual([
      {
        key: "BOOK0001",
        firstName: "",
        lastName: "WHO",
        fieldMode: 1,
        creatorType: "author",
        orderIndex: 0,
      },
      {
        key: "BOOK0001",
        firstName: "Ada",
        lastName: "Lovelace",
        fieldMode: 0,
        creatorType: "editor",
        orderIndex: 1,
      },
      {
        key: "BOOK0001",
        firstName: "",
        lastName: "Ada Lovelace",
        fieldMode: 1,
        creatorType: "author",
        orderIndex: 2,
      },
      {
        key: "BOOK0002",
        firstName: "",
        lastName: "WHO",
        fieldMode: 1,
        creatorType: "author",
        orderIndex: 0,
      },
    ]);
    expect(
      rows("select firstName, lastName, fieldMode from creators order by 2, 1"),
    ).toEqual([
      { firstName: "", lastName: "Ada Lovelace", fieldMode: 1 },
      { firstName: "Ada", lastName: "Lovelace", fieldMode: 0 },
      { firstName: "", lastName: "WHO", fieldMode: 1 },
    ]);
  });

  it("stores a collection name trimmed and NFC-normalised, as the collection setter of the client does", () => {
    expect(rows("select collectionName from collections")).toEqual([
      { collectionName: "Reading Café" },
    ]);
  });

  it("stores trimmed NFC tags, keeps case variants apart and keeps the last duplicate", () => {
    expect(
      rows(
        "select t.name, it.type from itemTags it join tags t using (tagID) where itemID = ? order by t.name",
        String(id("BOOK0001")),
      ),
    ).toEqual([
      { name: "Café", type: 0 },
      { name: "To-Read", type: 0 },
      { name: "dup", type: 1 },
      { name: "last", type: 0 },
      { name: "to-read", type: 1 },
    ]);
  });

  it("stores the ISBN hyphenated, as the setField of the client does", () => {
    expect(
      rows(
        `select v.value from itemData d join fieldsCombined f using (fieldID)
        join itemDataValues v using (valueID) where d.itemID = ? and f.fieldName = 'ISBN'`,
        String(id("BOOK0001")),
      ),
    ).toEqual([{ value: "978-0-306-40615-7" }]);
  });
});
