import type { ZoteroDatabase } from "#client/database.ts";
import type { QueryRow } from "#queries/_shared.ts";

import { defineToString } from "./to-string.ts";

import {
  collectionIDsByItemQuery,
  collectionNodesByLibraryQuery,
} from "#queries/collections.ts";

/**
 * A Zotero collection an item belongs to, in the template vocabulary. Coerces
 * to `name` in string contexts (like a tag coerces to its name).
 */
export interface TemplateCollection {
  /** Zotero collection key. */
  key: string;
  /** Collection name. */
  name: string;
  /**
   * Ancestor chain from top-level root to this collection: `path[0]` is the
   * top-level ancestor, `path[path.length - 1]` is this collection. A plain
   * array — render with `path.join(" > ")` (or `"/"` for filename folders), or
   * pipe the collection list through the `collection_paths` filter, which
   * joins each full ancestor path by a separator (`"/"` by default).
   */
  path: readonly string[];
}

type CollectionNodeRow = QueryRow<typeof collectionNodesByLibraryQuery>;

interface CollectionNode {
  collectionID: number;
  name: string;
  key: string;
  parentID: number | null;
}

function toNodeMap(
  rows: readonly CollectionNodeRow[],
): ReadonlyMap<number, CollectionNode> {
  return new Map(
    rows.map((row) => [
      row.collectionID,
      {
        collectionID: row.collectionID,
        name: row.collectionName,
        key: row.key,
        parentID: row.parentCollectionID,
      },
    ]),
  );
}

const byName = (a: TemplateCollection, b: TemplateCollection): number =>
  a.name.localeCompare(b.name);

export class CollectionCache {
  readonly #nodesByLibrary = new Map<
    number,
    ReadonlyMap<number, CollectionNode>
  >();
  readonly #resolved = new Map<number, TemplateCollection>();
  readonly #byItem = new Map<number, TemplateCollection[]>();

  byItemIDs(
    db: ZoteroDatabase,
    libraryID: number,
    itemIDs: readonly number[],
  ): Map<number, TemplateCollection[]> {
    const nodes = this.#nodes(db, libraryID);
    const result = new Map<number, TemplateCollection[]>();
    for (const itemID of itemIDs) {
      const cached = this.#byItem.get(itemID);
      if (cached) {
        result.set(itemID, cached);
        continue;
      }
      const rows = collectionIDsByItemQuery.prepared(db).all({ itemID });
      const collections = this.#resolveItem(rows, nodes);
      this.#byItem.set(itemID, collections);
      result.set(itemID, collections);
    }
    return result;
  }

  #resolveItem(
    rows: readonly { collectionID: number }[],
    nodes: ReadonlyMap<number, CollectionNode>,
  ): TemplateCollection[] {
    const collections: TemplateCollection[] = [];
    for (const { collectionID } of rows) {
      const resolved = this.#resolvePath(collectionID, nodes);
      if (resolved) collections.push(resolved);
    }
    return collections.toSorted(byName);
  }

  #nodes(
    db: ZoteroDatabase,
    libraryID: number,
  ): ReadonlyMap<number, CollectionNode> {
    return (
      this.#nodesByLibrary.get(libraryID) ??
      this.#storeNodes(
        libraryID,
        collectionNodesByLibraryQuery.prepared(db).all({ libraryID }),
      )
    );
  }

  #storeNodes(
    libraryID: number,
    rows: readonly CollectionNodeRow[],
  ): ReadonlyMap<number, CollectionNode> {
    const nodes = toNodeMap(rows);
    this.#nodesByLibrary.set(libraryID, nodes);
    return nodes;
  }

  #resolvePath(
    collectionID: number,
    nodes: ReadonlyMap<number, CollectionNode>,
  ): TemplateCollection | undefined {
    const memoized = this.#resolved.get(collectionID);
    if (memoized) return memoized;

    const node = nodes.get(collectionID);
    if (!node) return undefined;

    const parentPath =
      node.parentID == null
        ? []
        : (this.#resolvePath(node.parentID, nodes)?.path ?? []);
    const collection = toTemplateCollection({
      key: node.key,
      name: node.name,
      path: [...parentPath, node.name],
    });
    this.#resolved.set(collectionID, collection);
    return collection;
  }
}

export function toTemplateCollection(
  collection: TemplateCollection,
): TemplateCollection {
  return defineToString(
    { key: collection.key, name: collection.name, path: collection.path },
    function () {
      return this.name;
    },
  );
}
