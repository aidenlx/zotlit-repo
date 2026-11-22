type LibraryMenuContext = _ZoteroTypes.MenuManager.LibraryMenuContext;

export interface RowScope {
  groupID: number;
  collectionKey?: string;
}

function contextRow(
  context: LibraryMenuContext,
): Zotero.CollectionTreeRow | undefined {
  if ("collectionTreeRows" in context) {
    const rows = context.collectionTreeRows;
    return rows?.length === 1 ? rows[0] : undefined;
  }
  return context.collectionTreeRow as Zotero.CollectionTreeRow | undefined;
}

export function contextScope(context: LibraryMenuContext): RowScope | null {
  const row = contextRow(context);
  if (row?.isCollection()) {
    return {
      groupID: groupIDFromLibrary(row.ref.libraryID as number),
      collectionKey: row.ref.key as string,
    };
  }
  if (row?.isGroup()) {
    return { groupID: groupIDFromLibrary(row.ref.libraryID as number) };
  }
  return row?.isLibrary() ? { groupID: 0 } : null;
}

function groupIDFromLibrary(libraryID: number): number {
  if (libraryID === Zotero.Libraries.userLibraryID) return 0;
  return Zotero.Groups.getGroupIDFromLibraryID(libraryID);
}
