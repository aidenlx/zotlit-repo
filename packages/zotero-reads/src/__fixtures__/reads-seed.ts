export const SEED = `
  insert into version (schema, version) values ('userdata', 129);
  insert into libraries (libraryID, type, version, clientVersion)
    values (1, 'user', 7, 3), (2, 'group', 4, 2);
  insert into groups (groupID, libraryID, name) values (900, 2, 'Lab');
  insert into settings (setting, key, value)
    values ('account', 'userID', 42), ('account', 'username', 'reader');

  insert into itemTypes (itemTypeID, typeName)
    values (1, 'journalArticle'), (2, 'attachment'), (3, 'note'),
           (4, 'annotation'), (5, 'book');

  insert into fieldsCombined (fieldID, fieldName, custom)
    values (10, 'title', 0), (11, 'citationKey', 0), (12, 'date', 0),
           (13, 'shortTitle', 0);

  insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
    values
      (1, 1, '2024-01-01 00:00:00', '2024-02-01 00:00:00', 1, 'MAIN2345'),
      (2, 5, '2024-01-01 00:00:00', '2024-01-02 00:00:00', 1, 'RELB2345'),
      (3, 1, '2024-01-01 00:00:00', '2024-01-03 00:00:00', 1, 'RELA2345'),
      (10, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ATCH2345'),
      (100, 4, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ANNT2345'),
      (101, 4, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ANNT2346'),
      (200, 3, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'NTE22345'),
      (300, 1, '2024-01-01 00:00:00', '2024-01-04 00:00:00', 2, 'GRPITEMS');

  insert into itemDataValues (valueID, value)
    values (1, 'Main Study'), (2, 'Beta Book'), (3, 'Alpha Paper'),
           (4, 'main2024'), (5, '2024-05-06'), (6, 'Group Work'),
           (7, 'Main');
  insert into itemData (itemID, fieldID, valueID)
    values (1, 10, 1), (1, 11, 4), (1, 12, 5), (1, 13, 7),
           (2, 10, 2), (3, 10, 3), (300, 10, 6);

  insert into creators (creatorID, firstName, lastName, fieldMode)
    values (1, 'Ada', 'Lovelace', 0);
  insert into creatorTypes (creatorTypeID, creatorType) values (1, 'author');
  insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex)
    values (1, 1, 1, 0);
  insert into itemTypeCreatorTypes (itemTypeID, creatorTypeID, primaryField)
    values (1, 1, 1);

  insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
    values (10, 1, 0, 'application/pdf', 'storage:paper.pdf');
  insert into itemAnnotations (
    itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex,
    position, isExternal
  )
    values
      (100, 10, 1, 'excerpt', '<i>excerpt</i>', '#ffd400', '1',
       '00000|000000|00000', '{"pageIndex":0,"rects":[[0,0,1,1]]}', 0),
      (101, 10, 3, null, null, '#ffd400', '1',
       '00000|000001|00000', '{"pageIndex":0,"rects":[[0,0,1,1]]}', 0);
  insert into itemNotes (itemID, parentItemID, note, title)
    values (200, 1, '<p>body</p>', 'Methods');

  insert into tags (tagID, name) values (1, 'zt'), (2, 'method'), (3, 'claim');
  insert into itemTags (itemID, tagID, type)
    values (1, 1, 0), (2, 2, 0), (100, 3, 0);

  insert into relationPredicates (predicateID, predicate)
    values (1, 'dc:relation');
  insert into itemRelations (itemID, predicateID, object)
    values
      (1, 1, 'http://zotero.org/users/local/AAAAAAAA/items/RELB2345'),
      (1, 1, 'http://zotero.org/users/local/AAAAAAAA/items/RELA2345');

  insert into collections (collectionID, collectionName, libraryID, key)
    values (500, 'Reading', 1, 'CLL22345');
  insert into collectionItems (collectionID, itemID) values (500, 1), (500, 2);
`;
