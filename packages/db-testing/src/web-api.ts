import { regex } from "arkregex";
import type { DatabaseSync } from "node:sqlite";

import { isMultipartDate } from "@zotlit/zotero-types/date";
import { ZOTERO_VOCABULARY } from "@zotlit/zotero-types/vocabulary";
import type {
  WebApiCollection,
  WebApiCreator,
  WebApiGroup,
  WebApiItem,
  WebApiItemData,
  WebApiLibrary,
  WebApiLinkMode,
  WebApiTag,
} from "@zotlit/zotero-types/web-api";

export interface WebApiLibraryExport {
  readonly library: WebApiLibrary;
  readonly libraryID: number;
  readonly group: WebApiGroup | null;
  readonly collections: WebApiCollection[];
  readonly items: WebApiItem[];
}

export interface WebApiExportOptions {
  readonly userID: number;
  readonly username: string;
  readonly withoutMeta?: boolean;
}

const LINK_MODE: Record<number, WebApiLinkMode> = {
  0: "imported_file",
  1: "imported_url",
  2: "linked_file",
  3: "linked_url",
  4: "embedded_image",
};

const ANNOTATION_TYPE: Record<
  number,
  NonNullable<WebApiItemData["annotationType"]>
> = {
  1: "highlight",
  2: "note",
  3: "image",
  4: "ink",
  5: "underline",
  6: "text",
};

const CHILD_TYPES = new Set(["note", "attachment", "annotation"]);
const NOTE_WRAPPER_RE = regex(
  '^<div class="zotero-note znv[0-9]+">(?<inner>[\\s\\S]*)</div>$',
);
const SQL_DATE_PREFIX_RE = regex(
  "^(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})",
);
const STORED_FILE_RE = regex("^(?:attachments|storage):(?<path>.*)$", "s");

function sqlToIso(value: string): string | false {
  const match = SQL_DATE_PREFIX_RE.exec(value.slice(0, 10));
  if (!match) return false;
  const { year, month, day } = match.groups;
  let date = year;
  if (month !== "00") {
    date += `-${month}`;
    if (day !== "00") date += `-${day}`;
  }
  const time = value.slice(11);
  return time ? `${date}T${time}Z` : date;
}

export function exportWebApiLibraries(
  sqlite: DatabaseSync,
  options: WebApiExportOptions,
): WebApiLibraryExport[] {
  const libraries = sqlite
    .prepare(
      "select l.libraryID, l.type, g.groupID, g.name, g.description, g.version from libraries l left join groups g using (libraryID) where l.type in ('user', 'group') order by l.libraryID",
    )
    .all() as {
    libraryID: number;
    type: "user" | "group";
    groupID: number | null;
    name: string | null;
    description: string | null;
    version: number | null;
  }[];
  return libraries.map((row) => {
    const library: WebApiLibrary =
      row.type === "user"
        ? { type: "user", id: options.userID, name: options.username }
        : { type: "group", id: row.groupID!, name: row.name! };
    const base =
      row.type === "user" ? `users/${options.userID}` : `groups/${row.groupID}`;
    const group: WebApiGroup | null =
      row.type === "group"
        ? {
            id: row.groupID!,
            version: row.version!,
            data: {
              id: row.groupID!,
              version: row.version!,
              name: row.name!,
              owner: options.userID,
              type: "Private",
              description: row.description ?? "",
              url: "",
              libraryEditing: "members",
              libraryReading: "members",
              fileEditing: "members",
            },
          }
        : null;
    return {
      library,
      libraryID: row.libraryID,
      group,
      collections: exportCollections(sqlite, {
        libraryID: row.libraryID,
        library,
        base,
      }),
      items: exportItems(
        sqlite,
        { libraryID: row.libraryID, library, base },
        options,
      ),
    };
  });
}

function links(base: string, path: string) {
  return {
    self: {
      href: `https://api.zotero.org/${base}/${path}`,
      type: "application/json",
    },
  };
}

function exportCollections(
  sqlite: DatabaseSync,
  { libraryID, library, base }: LibraryScope,
): WebApiCollection[] {
  const rows = sqlite
    .prepare(
      `select c.key, c.version, c.collectionName as name, p.key as parentKey,
        exists (select 1 from deletedCollections d where d.collectionID = c.collectionID) as deleted
      from collections c left join collections p on p.collectionID = c.parentCollectionID
      where c.libraryID = ? order by c.collectionID`,
    )
    .all(libraryID) as {
    key: string;
    version: number;
    name: string;
    parentKey: string | null;
    deleted: number;
  }[];
  return rows.map((row) => ({
    key: row.key,
    version: row.version,
    library,
    links: links(base, `collections/${row.key}`),
    meta: {},
    data: {
      key: row.key,
      version: row.version,
      name: row.name,
      parentCollection: row.parentKey ?? false,
      relations: {},
      ...(row.deleted ? { deleted: true } : {}),
    },
  }));
}

interface LibraryScope {
  readonly libraryID: number;
  readonly library: WebApiLibrary;
  readonly base: string;
}

function exportItems(
  sqlite: DatabaseSync,
  { libraryID, library, base }: LibraryScope,
  options: WebApiExportOptions,
): WebApiItem[] {
  const items = sqlite
    .prepare(
      `select i.itemID, i.key, i.version, i.itemTypeID, t.typeName, i.dateAdded, i.dateModified,
        exists (select 1 from deletedItems d where d.itemID = i.itemID) as deleted
      from items i join itemTypesCombined t using (itemTypeID)
      where i.libraryID = ? order by i.itemID`,
    )
    .all(libraryID) as {
    itemID: number;
    key: string;
    version: number;
    itemTypeID: number;
    typeName: string;
    dateAdded: string;
    dateModified: string;
    deleted: number;
  }[];
  const statement = (query: string) => sqlite.prepare(query);
  const typeFields = statement(
    "select f.fieldName from itemTypeFieldsCombined x join fieldsCombined f using (fieldID) where x.itemTypeID = ? order by x.orderIndex",
  );
  const values = statement(
    "select f.fieldName, v.value from itemData d join fieldsCombined f using (fieldID) join itemDataValues v using (valueID) where d.itemID = ? and f.custom = 0",
  );
  const dateFields = new Set(ZOTERO_VOCABULARY.dateFields);
  const creators = statement(
    "select c.firstName, c.lastName, c.fieldMode, t.creatorType from itemCreators ic join creators c using (creatorID) join creatorTypes t using (creatorTypeID) where ic.itemID = ? order by ic.orderIndex",
  );
  const tags = statement(
    "select t.name, it.type from itemTags it join tags t using (tagID) where it.itemID = ? order by t.name",
  );
  const collections = statement(
    "select c.key from collectionItems ci join collections c using (collectionID) where ci.itemID = ? order by c.collectionID",
  );
  const relations = statement(
    "select p.predicate, r.object from itemRelations r join relationPredicates p using (predicateID) where r.itemID = ? order by p.predicate, r.object",
  );
  const parent = statement(
    `select p.key from (
      select parentItemID from itemNotes where itemID = ?1
      union all select parentItemID from itemAttachments where itemID = ?1
      union all select parentItemID from itemAnnotations where itemID = ?1
    ) as x join items p on p.itemID = x.parentItemID limit 1`,
  );
  const note = statement("select note from itemNotes where itemID = ?");
  const attachment = statement(
    "select a.linkMode, a.contentType, a.path, a.lastRead, c.charset from itemAttachments a left join charsets c using (charsetID) where a.itemID = ?",
  );
  const annotation = statement(
    "select type, authorName, text, comment, color, pageLabel, sortIndex, position from itemAnnotations where itemID = ?",
  );
  const groupUsers = statement(
    "select g.createdByUserID as createdID, cu.name as createdName, g.lastModifiedByUserID as modifiedID, mu.name as modifiedName from groupItems g left join users cu on cu.userID = g.createdByUserID left join users mu on mu.userID = g.lastModifiedByUserID where g.itemID = ?",
  );
  const numChildren = statement(
    `select count(*) as n from (
      select itemID from itemNotes where parentItemID = ?1
      union all select itemID from itemAttachments where parentItemID = ?1
    ) as c where c.itemID not in (select itemID from deletedItems)`,
  );

  return items.map((item) => {
    const data: Record<string, unknown> = {
      key: item.key,
      version: item.version,
      itemType: item.typeName,
    };
    const isChild = CHILD_TYPES.has(item.typeName);
    const parentKey = (parent.get(item.itemID) as { key: string } | undefined)
      ?.key;
    if (parentKey) data.parentItem = parentKey;

    for (const { fieldName } of typeFields.all(item.itemTypeID) as {
      fieldName: string;
    }[]) {
      data[fieldName] = "";
    }
    let parsedDate: string | undefined;
    for (const { fieldName, value } of values.all(item.itemID) as {
      fieldName: string;
      value: string | number;
    }[]) {
      let text = String(value);
      if (dateFields.has(fieldName) && isMultipartDate(text)) {
        if (fieldName === "date") {
          parsedDate = text.slice(0, 10).replace(/(-00)+$/, "");
        }
        text = text.slice(11);
      }
      if (fieldName === "accessDate") {
        const iso = sqlToIso(text);
        data[fieldName] = iso === false ? "" : iso;
        continue;
      }
      data[fieldName] = text;
    }

    if (!isChild) {
      data.creators = (
        creators.all(item.itemID) as {
          firstName: string;
          lastName: string;
          fieldMode: number;
          creatorType: string;
        }[]
      ).map((row): WebApiCreator =>
        row.fieldMode === 1
          ? { creatorType: row.creatorType, name: row.lastName }
          : {
              creatorType: row.creatorType,
              firstName: row.firstName,
              lastName: row.lastName,
            },
      );
    }

    let embeddedImage = false;
    if (item.typeName === "attachment") {
      const row = attachment.get(item.itemID) as {
        linkMode: number;
        contentType: string | null;
        path: string | null;
        lastRead: number | null;
        charset: string | null;
      };
      const linkMode = LINK_MODE[row.linkMode]!;
      embeddedImage = linkMode === "embedded_image";
      data.linkMode = linkMode;
      data.contentType = row.contentType ?? "";
      if (!embeddedImage) data.charset = row.charset ?? "";
      if (linkMode === "linked_file") data.path = row.path ?? "";
      else if (linkMode !== "linked_url") {
        data.filename =
          STORED_FILE_RE.exec(row.path ?? "")
            ?.groups.path?.split("/")
            .pop() ?? "";
      }
      if (library.type === "user" && row.lastRead) data.lastRead = row.lastRead;
    }
    if (
      (item.typeName === "attachment" && !embeddedImage) ||
      item.typeName === "note"
    ) {
      const stored =
        (note.get(item.itemID) as { note: string } | undefined)?.note ?? "";
      const unwrapped = NOTE_WRAPPER_RE.exec(stored);
      if (stored !== "" && !unwrapped) {
        throw new Error(
          `item ${item.key} has a note without the zotero-note wrapper, which the Zotero client never stores`,
        );
      }
      const text = unwrapped?.groups.inner ?? "";
      if (text !== "" || item.typeName === "note") data.note = text;
    }
    if (item.typeName === "annotation") {
      const row = annotation.get(item.itemID) as {
        type: number;
        authorName: string | null;
        text: string | null;
        comment: string | null;
        color: string | null;
        pageLabel: string | null;
        sortIndex: string;
        position: string;
      };
      const type = ANNOTATION_TYPE[row.type]!;
      data.annotationType = type;
      data.annotationAuthorName = row.authorName ?? "";
      if (type === "highlight" || type === "underline") {
        data.annotationText = row.text ?? "";
      }
      data.annotationComment = row.comment ?? "";
      data.annotationColor = row.color ?? "";
      data.annotationPageLabel = row.pageLabel ?? "";
      data.annotationSortIndex = row.sortIndex ?? "";
      data.annotationPosition = row.position ?? "";
    }

    if (!embeddedImage) {
      data.tags = (
        tags.all(item.itemID) as { name: string; type: number }[]
      ).map((row): WebApiTag =>
        row.type === 1 ? { tag: row.name, type: 1 } : { tag: row.name },
      );
      if (!parentKey) {
        data.collections = (
          collections.all(item.itemID) as { key: string }[]
        ).map((row) => row.key);
      }
      const grouped: Record<string, string[]> = {};
      for (const row of relations.all(item.itemID) as {
        predicate: string;
        object: string;
      }[]) {
        (grouped[row.predicate] ??= []).push(row.object);
      }
      data.relations = Object.fromEntries(
        Object.entries(grouped).map(([predicate, objects]) => [
          predicate,
          objects.length === 1 ? objects[0]! : objects,
        ]),
      );
    }
    if (item.deleted) data.deleted = true;
    data.dateAdded = sqlToIso(item.dateAdded);
    data.dateModified = sqlToIso(item.dateModified);

    const meta: Record<string, unknown> = {};
    if (parsedDate) meta.parsedDate = parsedDate;
    meta.numChildren = isChild
      ? 0
      : (numChildren.get(item.itemID) as { n: number }).n;
    if (library.type === "group") {
      const users = groupUsers.get(item.itemID) as
        | {
            createdID: number | null;
            createdName: string | null;
            modifiedID: number | null;
            modifiedName: string | null;
          }
        | undefined;
      if (users?.createdID) {
        meta.createdByUser = {
          id: users.createdID,
          username: users.createdName,
          name: users.createdName,
        };
      }
      if (users?.modifiedID) {
        meta.lastModifiedByUser = {
          id: users.modifiedID,
          username: users.modifiedName,
          name: users.modifiedName,
        };
      }
    }

    return {
      key: item.key,
      version: item.version,
      library,
      links: links(base, `items/${item.key}`),
      ...(options.withoutMeta ? {} : { meta }),
      data: data as WebApiItemData,
    };
  });
}
