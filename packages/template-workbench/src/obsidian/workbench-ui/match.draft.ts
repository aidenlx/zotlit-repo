import type { ExpressionVocabulary } from "#core/language/filter-expression-completion.ts";
import type { PlacedFault } from "#core/language/span.ts";
import type { ReactNode } from "react";

import { filterGroup } from "@zotlit/filter-expression";
import type {
  FilterGroupKind,
  FilterPath,
  FilterTree,
} from "@zotlit/filter-expression";

import { pathStartsWith, samePath } from "./row-path.ts";
import type { RowPath } from "./row-path.ts";

export interface ExpressionCondition {
  kind: "expression";
  text: string;
}

export interface LabelledRow {
  kind: string;
}

export type RowCondition<Row extends LabelledRow> = Row | ExpressionCondition;
export type GroupMatch = "all" | "any" | "none";
export interface ConditionGroup<Row extends LabelledRow> {
  kind: "group";
  match: GroupMatch;
  conditions: EditorCondition<Row>[];
}
export type EditorCondition<Row extends LabelledRow> =
  | ConditionGroup<Row>
  | RowCondition<Row>;

export type ConditionPath = RowPath;

export type MatchFilter = FilterTree;

const GROUP_MATCH: Record<FilterGroupKind, GroupMatch> = {
  and: "all",
  or: "any",
  not: "none",
};

export interface ConditionControlProps<Row extends LabelledRow> {
  condition: Row;
  onChange: (next: Row) => void;
}

export interface MatchConditionKind<Row extends LabelledRow> {
  kind: Row["kind"];
  label: string;
  icon?: ReactNode;
  detail?: string;
  searchTerms?: readonly string[];
  fresh: () => Row;
  parse: (text: string) => Row | null;
  format: (row: Row) => string | null;
  renderOperator?: (props: ConditionControlProps<Row>) => ReactNode;
  renderValue: (props: ConditionControlProps<Row>) => ReactNode;
}

export interface MatchVocabulary<Row extends LabelledRow> {
  kinds: readonly MatchConditionKind<Row>[];
  newKind: Row["kind"];
  issue?: (condition: RowCondition<Row>, path: FilterPath) => string | null;
  expression?: ExpressionVocabulary;
  fault?: (path: FilterPath) => PlacedFault | undefined;
}

export function isGroup<Row extends LabelledRow>(
  node: EditorCondition<Row>,
): node is ConditionGroup<Row> {
  return node.kind === "group";
}

export function isExpression<Row extends LabelledRow>(
  node: RowCondition<Row>,
): node is ExpressionCondition {
  return node.kind === "expression";
}

function kindOf<Row extends LabelledRow>(
  vocabulary: MatchVocabulary<Row>,
  kind: Row["kind"],
): MatchConditionKind<Row> {
  const entry = vocabulary.kinds.find((entry) => entry.kind === kind);
  if (!entry) throw new Error(`Unknown Match condition kind: ${kind}`);
  return entry;
}

export function freshRow<Row extends LabelledRow>(
  vocabulary: MatchVocabulary<Row>,
  kind: Row["kind"],
): Row {
  return kindOf(vocabulary, kind).fresh();
}

export function fromFilter<Row extends LabelledRow>(
  filter: MatchFilter | undefined,
  vocabulary: MatchVocabulary<Row>,
): ConditionGroup<Row> {
  const node: EditorCondition<Row> =
    filter === undefined
      ? { kind: "group", match: "all", conditions: [] }
      : editorNode(filter, vocabulary);
  return settle(
    isGroup(node) ? node : { kind: "group", match: "all", conditions: [node] },
    vocabulary,
  );
}

function editorNode<Row extends LabelledRow>(
  filter: MatchFilter,
  vocabulary: MatchVocabulary<Row>,
): EditorCondition<Row> {
  if (typeof filter === "string")
    return (
      asLabelled({ kind: "expression", text: filter }, vocabulary) ?? {
        kind: "expression",
        text: filter,
      }
    );
  const [kind, entries] = filterGroup(filter);
  return {
    kind: "group",
    match: GROUP_MATCH[kind],
    conditions: entries.map((entry) => editorNode(entry, vocabulary)),
  };
}

export interface StoredFilter {
  readonly filter: MatchFilter | undefined;
  readonly places: ReadonlyMap<string, FilterPath>;
}

export const placeKey = (path: ConditionPath): string => path.join(".");

export function storedFilter<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  vocabulary: MatchVocabulary<Row>,
): StoredFilter {
  const places = new Map<string, FilterPath>();
  const visit = (
    group: ConditionGroup<Row>,
    path: ConditionPath,
    place: FilterPath,
  ): MatchFilter | undefined => {
    const entries: MatchFilter[] = [];
    group.conditions.forEach((node, index) => {
      const at = [...path, index];
      const next = [...place, entries.length];
      let stored: MatchFilter | undefined;
      if (isGroup(node)) stored = visit(node, at, next);
      else {
        stored = isExpression(node)
          ? node.text.trim() === ""
            ? undefined
            : node.text
          : (kindOf(vocabulary, node.kind).format(node) ?? undefined);
        if (stored !== undefined) places.set(placeKey(at), next);
      }
      if (stored !== undefined) entries.push(stored);
    });
    if (entries.length === 0) return undefined;
    switch (group.match) {
      case "all":
        return { and: entries };
      case "any":
        return { or: entries };
      case "none":
        return { not: entries };
    }
  };
  return { filter: visit(root, [], []), places };
}

export function fitsVocabulary<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  vocabulary: MatchVocabulary<Row>,
): boolean {
  return root.conditions.every((node) =>
    isGroup(node)
      ? fitsVocabulary(node, vocabulary)
      : isExpression(node) ||
        vocabulary.kinds.some((entry) => entry.kind === node.kind),
  );
}

export function storesFilter<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  filter: MatchFilter | undefined,
  vocabulary: MatchVocabulary<Row>,
): boolean {
  return (
    JSON.stringify(storedFilter(root, vocabulary).filter) ===
    JSON.stringify(filter)
  );
}

export function placeholderRow<Row extends LabelledRow>(
  vocabulary: MatchVocabulary<Row>,
): Row {
  return freshRow(vocabulary, vocabulary.newKind);
}

export function settle<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  vocabulary: MatchVocabulary<Row>,
): ConditionGroup<Row> {
  const prune = (group: ConditionGroup<Row>): ConditionGroup<Row> => ({
    ...group,
    conditions: group.conditions.flatMap((child): EditorCondition<Row>[] => {
      if (!isGroup(child)) return [child];
      const pruned = prune(child);
      return pruned.conditions.length === 0 ? [] : [pruned];
    }),
  });
  const pruned = prune(root);
  return pruned.conditions.length === 0
    ? { ...pruned, conditions: [placeholderRow(vocabulary)] }
    : pruned;
}

export function updateGroup<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  path: ConditionPath,
  fn: (group: ConditionGroup<Row>) => ConditionGroup<Row>,
): ConditionGroup<Row> {
  if (path.length === 0) return fn(root);
  const [index, ...rest] = path;
  return {
    ...root,
    conditions: root.conditions.map((child, at) =>
      at === index && isGroup(child) ? updateGroup(child, rest, fn) : child,
    ),
  };
}

export function replaceAt<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  path: ConditionPath,
  next: EditorCondition<Row>,
): ConditionGroup<Row> {
  const index = path.at(-1)!;
  return updateGroup(root, path.slice(0, -1), (group) => ({
    ...group,
    conditions: group.conditions.map((child, at) =>
      at === index ? next : child,
    ),
  }));
}

export function removeAt<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  path: ConditionPath,
): ConditionGroup<Row> {
  const index = path.at(-1)!;
  return updateGroup(root, path.slice(0, -1), (group) => ({
    ...group,
    conditions: group.conditions.filter((_, at) => at !== index),
  }));
}

export function appendAt<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  path: ConditionPath,
  child: EditorCondition<Row>,
): ConditionGroup<Row> {
  return updateGroup(root, path, (group) => ({
    ...group,
    conditions: [...group.conditions, child],
  }));
}

function nodeAt<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  path: ConditionPath,
): EditorCondition<Row> | undefined {
  let node: EditorCondition<Row> | undefined = root;
  for (const index of path)
    node = node && isGroup(node) ? node.conditions[index] : undefined;
  return node;
}

export interface ConditionPlace {
  group: ConditionPath;
  index: number;
}

export function moveAt<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  from: ConditionPath,
  { group: toGroup, index }: ConditionPlace,
): ConditionGroup<Row> {
  const node = nodeAt(root, from);
  const target = nodeAt(root, toGroup);
  if (from.length === 0 || !node || !target || !isGroup(target)) return root;
  if (pathStartsWith(toGroup, from)) return root;
  const parent = from.slice(0, -1);
  const removed = from.at(-1)!;
  if (samePath(parent, toGroup) && index === removed) return root;
  const shifted = toGroup.map((at, depth) =>
    depth === parent.length && pathStartsWith(toGroup, parent) && at > removed
      ? at - 1
      : at,
  );
  return updateGroup(removeAt(root, from), shifted, (group) => {
    const conditions = [...group.conditions];
    conditions.splice(Math.max(0, Math.min(index, conditions.length)), 0, node);
    return { ...group, conditions };
  });
}

export function asExpression<Row extends LabelledRow>(
  condition: Row,
  vocabulary: MatchVocabulary<Row>,
): ExpressionCondition {
  return {
    kind: "expression",
    text: kindOf(vocabulary, condition.kind).format(condition) ?? "",
  };
}

export function asLabelled<Row extends LabelledRow>(
  condition: ExpressionCondition,
  vocabulary: MatchVocabulary<Row>,
): Row | null {
  for (const kind of vocabulary.kinds) {
    const row = kind.parse(condition.text);
    if (row) return row;
  }
  return null;
}

export function freshGroup<Row extends LabelledRow>(
  vocabulary: MatchVocabulary<Row>,
): ConditionGroup<Row> {
  return {
    kind: "group",
    match: "all",
    conditions: [placeholderRow(vocabulary)],
  };
}
