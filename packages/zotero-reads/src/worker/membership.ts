import { getCollectionNodesByLibrary } from "@zotlit/db";
import type { CollectionNode, ZoteroDatabase } from "@zotlit/db";

export interface CollectionChoice {
  path: readonly string[];
}

export function listCollectionChoices(
  client: ZoteroDatabase,
  libraries: readonly { readonly libraryID: number }[],
): CollectionChoice[] {
  const byPath = new Map<string, CollectionChoice>();
  for (const { libraryID } of libraries) {
    for (const choice of libraryChoices(
      getCollectionNodesByLibrary(client, libraryID),
    ))
      byPath.set(choice.path.join("/"), choice);
  }
  return [...byPath.values()].sort((a, b) => comparePaths(a.path, b.path));
}

function libraryChoices(rows: readonly CollectionNode[]): CollectionChoice[] {
  const nodes = nodeMap(rows);
  return [...nodes.values()]
    .map((node) => ({
      path: [...ancestorsOf(node, nodes).toReversed(), node].map(
        ({ collectionName }) => collectionName,
      ),
    }))
    .sort((a, b) => comparePaths(a.path, b.path));
}

function nodeMap(
  rows: readonly CollectionNode[],
): ReadonlyMap<number, CollectionNode> {
  return new Map(rows.map((row) => [row.collectionID, row]));
}

function ancestorsOf(
  node: CollectionNode,
  nodes: ReadonlyMap<number, CollectionNode>,
): CollectionNode[] {
  const parentOf = (child: CollectionNode) =>
    child.parentCollectionID === null
      ? undefined
      : nodes.get(child.parentCollectionID);
  const chain: CollectionNode[] = [];
  let parent = parentOf(node);
  while (parent) {
    chain.push(parent);
    parent = parentOf(parent);
  }
  return chain;
}

function comparePaths(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const order = a[i]!.localeCompare(b[i]!);
    if (order !== 0) return order;
  }
  return a.length - b.length;
}
