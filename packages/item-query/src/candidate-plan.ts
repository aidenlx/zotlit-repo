import { Effect } from "effect";

import type {
  CandidateLeaf,
  SeekCandidateLeaf,
  CollectionPaths,
  FieldVocabulary,
  ItemQueryDatabase,
  ItemQueryReaderError,
} from "@zotlit/db/item-query";

import { isStoredStringField } from "./fields.ts";
import type { FilterNode } from "./filter-plan.ts";
import { lowerIndexedKeySelection } from "./indexed-key-selection.ts";
import type { TargetLibrary } from "./request.ts";

export type CandidatePlan<Leaf = CandidateLeaf> =
  | { readonly kind: "leaf"; readonly leaf: Leaf; readonly sweep?: true }
  | { readonly kind: "all"; readonly plans: readonly CandidatePlan<Leaf>[] }
  | { readonly kind: "any"; readonly plans: readonly CandidatePlan<Leaf>[] };

export interface CandidateSources {
  readonly library: TargetLibrary;
  readonly vocabulary: FieldVocabulary | null;
  readonly collectionPaths: CollectionPaths | undefined;
}

type Lowering = <Item>(
  node: FilterNode<Item>,
  sources: CandidateSources,
) => SeekCandidateLeaf | null;

const stringLiteral = <Item>(
  node: FilterNode<Item> | undefined,
): string | null =>
  node?.kind === "literal" && typeof node.value === "string"
    ? node.value
    : null;

const lowerTagContains: Lowering = (node) => {
  if (node.kind !== "method" || node.name !== "contains") return null;
  if (node.subject.kind !== "field" || node.subject.name !== "tags") {
    return null;
  }
  const name = node.args.length === 1 ? stringLiteral(node.args[0]) : null;
  return name === null ? null : { kind: "tag", value: name };
};

export function equality<Item>(
  node: FilterNode<Item>,
  accepts: (name: string) => boolean,
): { name: string; value: string } | null {
  if (node.kind !== "binary" || node.operator !== "==") return null;
  for (const [field, literal] of [
    [node.left, node.right],
    [node.right, node.left],
  ] as const) {
    if (field.kind !== "field" || !accepts(field.name)) continue;
    const value = stringLiteral(literal);
    if (value !== null) return { name: field.name, value };
  }
  return null;
}

const lowerKeyEquals: Lowering = (node) => {
  const match = equality(node, (name) => name === "key");
  return match && { kind: "key", key: match.value };
};

const lowerFieldEquals: Lowering = (node, { vocabulary }) => {
  const match = vocabulary && equality(node, isStoredStringField);
  return (
    match && {
      kind: "field",
      fieldIDs: vocabulary.fieldIDsOf(match.name),
      value: match.value,
    }
  );
};

const lowerCollections: Lowering = (node, { collectionPaths }) => {
  if (node.kind !== "method" || !collectionPaths) return null;
  if (node.name !== "contains" && node.name !== "within") return null;
  if (node.subject.kind !== "field" || node.subject.name !== "collections") {
    return null;
  }
  const path = node.args.length === 1 ? stringLiteral(node.args[0]) : null;
  if (path === null) return null;
  const subtree = node.name === "within";
  const collectionIDs: number[] = [];
  for (const [collectionID, names] of collectionPaths) {
    const joined = names.join("/");
    if (joined === path || (subtree && joined.startsWith(`${path}/`))) {
      collectionIDs.push(collectionID);
    }
  }
  return { kind: "collection", collectionIDs };
};

const LOWERINGS: readonly Lowering[] = [
  lowerTagContains,
  lowerKeyEquals,
  lowerFieldEquals,
  lowerCollections,
];

function allOf<Leaf>(
  branches: readonly (CandidatePlan<Leaf> | null)[],
): CandidatePlan<Leaf> | null {
  const plans = branches
    .filter((plan) => plan !== null)
    .flatMap((plan) => (plan.kind === "all" ? plan.plans : [plan]));
  if (plans.length === 0) return null;
  return plans.length === 1 ? plans[0]! : { kind: "all", plans };
}

export function planCandidates<Item, Leaf = CandidateLeaf>(
  node: FilterNode<Item>,
  sources: CandidateSources,
  lowerLeaf: (
    node: FilterNode<Item>,
    sources: CandidateSources,
  ) => Leaf | null = lowerItemCandidate as (
    node: FilterNode<Item>,
    sources: CandidateSources,
  ) => Leaf | null,
): CandidatePlan<Leaf> | null {
  if (node.kind === "binary" && node.operator === "&&") {
    return allOf(
      [node.left, node.right].map((side) =>
        planCandidates(side, sources, lowerLeaf),
      ),
    );
  }
  if (node.kind === "binary" && node.operator === "||") {
    const left = planCandidates(node.left, sources, lowerLeaf);
    const right = planCandidates(node.right, sources, lowerLeaf);
    return left && right
      ? {
          kind: "any",
          plans: [left, right].flatMap((plan) =>
            plan.kind === "any" ? plan.plans : [plan],
          ),
        }
      : null;
  }
  if (
    node.kind === "method" &&
    (node.name === "containsAny" || node.name === "containsAll")
  ) {
    if (node.subject.valueType === "string") return null;
    const values =
      node.args.length === 1 && node.args[0]?.kind === "list"
        ? node.args[0].elements
        : node.args;
    if (!values.length || values.some((value) => stringLiteral(value) === null))
      return null;
    const plans = values.map((value) =>
      planCandidates(
        { ...node, name: "contains", args: [value] },
        sources,
        lowerLeaf,
      ),
    );
    if (node.name === "containsAll") return allOf(plans);
    return plans.every((plan) => plan !== null) ? { kind: "any", plans } : null;
  }
  const leaf = lowerLeaf(node, sources);
  return leaf ? { kind: "leaf", leaf } : null;
}

export const lowerItemCandidate: Lowering = (node, sources) => {
  const keys = lowerIndexedKeySelection(node, "items", sources.library);
  if (keys) return { kind: "keys", keys: keys.keys };
  for (const lower of LOWERINGS) {
    const leaf = lower(node, sources);
    if (leaf) return leaf;
  }
  return null;
};

export type CandidateFallback =
  | "candidate-cap-exceeded"
  | "sparse-library"
  | "relation-page-budget-exhausted"
  | "parent-page-budget-exhausted";

export const readCandidatePlan = Effect.fnUntraced(function* <Leaf>(
  plan: CandidatePlan<Leaf>,
  options: {
    libraryID: number;
    cap: number;
    readLeaf: (candidates: {
      libraryID: number;
      leaf: Leaf;
      limit: number;
    }) => Effect.Effect<
      number[] | CandidateFallback,
      ItemQueryReaderError,
      ItemQueryDatabase
    >;
  },
): Effect.fn.Return<
  ReadonlySet<number> | CandidateFallback,
  ItemQueryReaderError,
  ItemQueryDatabase
> {
  const { libraryID, cap, readLeaf } = options;
  if (plan.kind === "leaf") {
    const itemIDs = yield* readLeaf({
      libraryID,
      leaf: plan.leaf,
      limit: cap + 1,
    });
    if (typeof itemIDs === "string") return itemIDs;
    return itemIDs.length > cap ? "candidate-cap-exceeded" : new Set(itemIDs);
  }
  const branches = plan.plans.toSorted((a, b) => sweepOrder(a) - sweepOrder(b));
  if (plan.kind === "any") {
    const union = new Set<number>();
    for (const branch of branches) {
      const set = yield* readCandidatePlan(branch, options);
      if (typeof set === "string") return set;
      for (const itemID of set) union.add(itemID);
      if (union.size > cap) return "candidate-cap-exceeded";
    }
    return union;
  }
  const sets: ReadonlySet<number>[] = [];
  let hasSeekSet = false;
  let reason: CandidateFallback | undefined;
  for (const branch of branches) {
    if (hasSeekSet && hasSweep(branch)) continue;
    const set = yield* readCandidatePlan(branch, options);
    if (typeof set === "string") reason ??= set;
    else {
      sets.push(set);
      if (!requiresSweep(branch)) hasSeekSet = true;
    }
  }
  if (sets.length === 0) return reason!;
  return sets.reduce(
    (kept, set) => new Set([...kept].filter((itemID) => set.has(itemID))),
  );
});

function requiresSweep<Leaf>(plan: CandidatePlan<Leaf>): boolean {
  if (plan.kind === "leaf") return plan.sweep === true;
  return plan.kind === "all"
    ? plan.plans.every(requiresSweep)
    : plan.plans.some(requiresSweep);
}

function sweepOrder<Leaf>(plan: CandidatePlan<Leaf>): 0 | 1 | 2 {
  if (plan.kind === "leaf") return plan.sweep ? 2 : 0;
  const orders = plan.plans.map(sweepOrder);
  if (orders.every((order) => order === 0)) return 0;
  return orders.every((order) => order === 2) ? 2 : 1;
}

export function hasSweep<Leaf>(plan: CandidatePlan<Leaf>): boolean {
  return plan.kind === "leaf" ? plan.sweep === true : plan.plans.some(hasSweep);
}
