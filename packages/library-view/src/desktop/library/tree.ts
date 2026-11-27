import type { QueryViewGroup } from "@zotlit/query-views/worker/item-query/query-view.ts";
import type {
  AvailableLibrary,
  LibrarySelector,
} from "@zotlit/zotero-reads/contract/library-scope.ts";
import { selectorKey } from "@zotlit/zotero-reads/contract/library-scope.ts";
import { parseIndexedKey } from "@zotlit/zotero-types/keys";

import type { LibraryNode } from "./document.ts";
import { nodeKey } from "./document.ts";

export interface TreeCollection {
  readonly path: readonly string[];
  readonly count: number | null;
  readonly children: readonly TreeCollection[];
}

export interface TreeLibrary {
  readonly library: AvailableLibrary;
  readonly count: number | null;
  readonly collections: readonly TreeCollection[];
}

export interface LibraryCounts {
  readonly totalCount: number;
  readonly groups: readonly Pick<QueryViewGroup, "value" | "rows">[];
}

export function collectionTree(
  paths: readonly (readonly string[])[],
  counts: LibraryCounts | null,
): TreeCollection[] {
  const items = new Map<string, Set<string>>();
  for (const { value, rows } of counts?.groups ?? []) {
    if (typeof value !== "string") continue;
    const names = value.split("/");
    for (let depth = 1; depth <= names.length; depth++) {
      const path = names.slice(0, depth).join("/");
      let keys = items.get(path);
      if (!keys) items.set(path, (keys = new Set()));
      for (const { indexedKey } of rows) keys.add(indexedKey);
    }
  }
  const children = Map.groupBy(
    [...new Map(paths.map((path) => [path.join("/"), path])).values()],
    (path) => path.slice(0, -1).join("/"),
  );
  const build = (parent: string): TreeCollection[] =>
    (children.get(parent) ?? []).map((path) => {
      const own = path.join("/");
      return {
        path,
        count: counts ? (items.get(own)?.size ?? 0) : null,
        children: build(own),
      };
    });
  return build("");
}

export function findNode(
  libraries: readonly TreeLibrary[],
  node: LibraryNode,
): TreeLibrary | TreeCollection | null {
  if (node.kind === "recent") return null;
  const library = libraries.find((entry) =>
    sameLibrary(entry.library.selector, node.library),
  );
  if (!library || node.kind === "library") return library ?? null;
  let level: readonly TreeCollection[] = library.collections;
  let found: TreeCollection | null = null;
  for (const [depth, name] of node.path.entries()) {
    found = level.find(({ path }) => path[depth] === name) ?? null;
    if (!found) return null;
    level = found.children;
  }
  return found;
}

export function sameLibrary(a: LibrarySelector, b: LibrarySelector): boolean {
  return selectorKey(a) === selectorKey(b);
}

export function libraryOf(indexedKey: string): LibrarySelector | null {
  const parsed = parseIndexedKey(indexedKey);
  if (!parsed) return null;
  return parsed.groupID === null
    ? { type: "personal" }
    : { type: "group", groupID: parsed.groupID };
}

export const CLOSED_PREFIX = "closed:";

export function knowsNode(
  libraries: readonly { tree: TreeLibrary; complete: boolean }[],
): (key: string) => boolean {
  const known = new Set<string>();
  const read = new Set<string>();
  const walk = (library: LibrarySelector, list: readonly TreeCollection[]) => {
    for (const { path, children } of list) {
      known.add(nodeKey({ kind: "collection", library, path }));
      walk(library, children);
    }
  };
  for (const { tree, complete } of libraries) {
    if (!complete) continue;
    const { selector } = tree.library;
    read.add(selectorKey(selector));
    known.add(
      `${CLOSED_PREFIX}${nodeKey({ kind: "library", library: selector })}`,
    );
    walk(selector, tree.collections);
  }
  return (key) => {
    if (known.has(key)) return true;
    const names = parseNames(
      key.startsWith(CLOSED_PREFIX) ? key.slice(CLOSED_PREFIX.length) : key,
    );
    return names !== null && !read.has(names[0]!);
  };
}

function parseNames(key: string): string[] | null {
  try {
    const names: unknown = JSON.parse(key);
    return Array.isArray(names) &&
      names.length > 0 &&
      names.every((name) => typeof name === "string")
      ? names
      : null;
  } catch {
    return null;
  }
}
