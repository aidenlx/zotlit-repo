export type FilterTree =
  | string
  | {
      [K in FilterGroupKind]: { readonly [P in K]: readonly FilterTree[] };
    }[FilterGroupKind];

export const FILTER_GROUP_KINDS = ["and", "or", "not"] as const;
export type FilterGroupKind = (typeof FILTER_GROUP_KINDS)[number];

export type FilterPath = readonly number[];

export interface FilterTreeFold<T> {
  leaf: (expression: string, path: FilterPath) => T;
  group: (kind: FilterGroupKind, entries: T[], path: FilterPath) => T;
}

export function filterGroup(
  tree: Exclude<FilterTree, string>,
): [FilterGroupKind, readonly FilterTree[]] {
  return "and" in tree
    ? ["and", tree.and]
    : "or" in tree
      ? ["or", tree.or]
      : ["not", tree.not];
}

export function foldFilterTree<T>(
  tree: FilterTree,
  fold: FilterTreeFold<T>,
): T {
  const visit = (node: FilterTree, path: FilterPath): T => {
    if (typeof node === "string") return fold.leaf(node, path);
    const [kind, entries] = filterGroup(node);
    return fold.group(
      kind,
      entries.map((entry, index) => visit(entry, [...path, index])),
      path,
    );
  };
  return typeof tree === "string" ? fold.leaf(tree, [0]) : visit(tree, []);
}

export function readFilterTree(
  value: unknown,
  scalars: "text" | "refuse" = "text",
): FilterTree | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return scalars === "text" ? String(value) : null;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const keys = Object.keys(value);
  if (keys.length !== 1) return null;
  const kind = FILTER_GROUP_KINDS.find((group) => group === keys[0]);
  if (kind === undefined) return null;
  const entries = (value as Record<string, unknown>)[kind];
  if (!Array.isArray(entries)) return null;
  const children: FilterTree[] = [];
  for (const entry of entries) {
    const child = readFilterTree(entry, scalars);
    if (child === null) return null;
    children.push(child);
  }
  return filterGroupOf(kind, children);
}

function filterGroupOf(
  kind: FilterGroupKind,
  entries: readonly FilterTree[],
): FilterTree {
  switch (kind) {
    case "and":
      return { and: entries };
    case "or":
      return { or: entries };
    case "not":
      return { not: entries };
  }
}

export function isFilterTree(value: unknown): value is FilterTree {
  return readFilterTree(value, "refuse") !== null;
}

export interface FilterLeaf {
  readonly path: FilterPath;
  readonly from: number;
  readonly to: number;
}

export interface ComposedFilter<Leaf extends FilterLeaf = FilterLeaf> {
  readonly text: string;
  readonly leaves: readonly Leaf[];
}

const shift = <Leaf extends FilterLeaf>(
  leaves: readonly Leaf[],
  by: number,
): Leaf[] =>
  leaves.map((leaf) => ({ ...leaf, from: leaf.from + by, to: leaf.to + by }));

export function joinComposed<Leaf extends FilterLeaf>(
  parts: readonly ComposedFilter<Leaf>[],
  joiner: string,
): ComposedFilter<Leaf> {
  if (parts.length === 1) return parts[0]!;
  let text = "";
  const leaves: Leaf[] = [];
  parts.forEach((part, index) => {
    if (index > 0) text += joiner;
    text += "(";
    leaves.push(...shift(part.leaves, text.length));
    text += `${part.text})`;
  });
  return { text, leaves };
}

export function composeFilterTree(tree: FilterTree): ComposedFilter {
  return foldFilterTree<ComposedFilter>(tree, {
    leaf: (text, path) => ({
      text,
      leaves: [{ path, from: 0, to: text.length }],
    }),
    group: (kind, entries) => {
      if (entries.length === 0)
        return { text: kind === "or" ? "false" : "true", leaves: [] };
      if (kind === "and") return joinComposed(entries, " && ");
      const any = joinComposed(entries, " || ");
      if (kind === "or") return any;
      return { text: `!(${any.text})`, leaves: shift(any.leaves, 2) };
    },
  });
}
