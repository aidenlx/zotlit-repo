import type {
  FilterLocation,
  FilterSection,
  QueryFile,
  QueryFileView,
} from "#core/query-view/query-file.ts";

import {
  composeFilterTree,
  filterGroup,
  joinComposed,
  parseExpressionAst,
} from "@zotlit/filter-expression";
import type {
  ComposedFilter,
  ExpressionNode,
  FilterLeaf,
  FilterTree,
} from "@zotlit/filter-expression";
import type {
  PlacedFault,
  Span,
} from "@zotlit/template-workbench/core/language/index.ts";

import { allViewsDataset } from "#core/query-view/query-file.ts";

export interface VaultRead {
  readonly name: string;
  readonly from: number;
  readonly to: number;
}

export interface VaultCondition extends FilterLocation {
  readonly text: string;
  readonly reads: readonly VaultRead[] | null;
  readonly within: ConditionLeaf;
}

export interface ConditionFault extends FilterLocation {
  readonly fault: PlacedFault;
}

export interface EngineFilter {
  readonly text: string;
  locate(span: Span): ConditionFault | null;
}

export interface FilterSplit {
  readonly vault: readonly VaultCondition[];
  readonly stranded: readonly FilterLocation[];
  engine(keys: string | null): EngineFilter | undefined;
}

interface Conjunct {
  readonly from: number;
  readonly to: number;
  readonly vault: VaultCondition | undefined;
}

export interface ConditionLeaf {
  readonly text: string;
  readonly offset: number;
}

type Composed = ComposedFilter<FilterLocation & FilterLeaf & ConditionLeaf>;

export function splitFilters(
  file: QueryFile,
  view: QueryFileView,
): FilterSplit {
  const vault: VaultCondition[] = [];
  const stranded: FilterLocation[] = [];
  const parts: Composed[] = [];
  for (const [tree, section] of filterSections(file, view)) {
    const split = splitSection(tree, section);
    vault.push(...split.vault);
    stranded.push(...split.stranded);
    if (split.engine) parts.push(split.engine);
  }
  const filters = parts.length === 0 ? undefined : joinComposed(parts, " && ");
  return {
    vault,
    stranded,
    engine(keys) {
      const composed = withKeys(filters, keys);
      if (!composed) return undefined;
      return {
        text: composed.text,
        locate: ({ from, to }) => {
          const leaf = composed.leaves.find(
            (leaf) => leaf.from <= from && to <= leaf.to,
          );
          if (!leaf) return null;
          const by = leaf.offset - leaf.from;
          return {
            section: leaf.section,
            path: leaf.path,
            fault: {
              text: leaf.text,
              span: { from: from + by, to: to + by },
            },
          };
        },
      };
    },
  };
}

function filterSections(
  file: QueryFile,
  view: QueryFileView,
): [FilterTree, FilterSection][] {
  const sections: [FilterTree, FilterSection][] = [];
  if (
    file.filters !== undefined &&
    (view.from ?? "annotations") === allViewsDataset(file)
  )
    sections.push([file.filters, "all"]);
  if (view.filters !== undefined) sections.push([view.filters, "view"]);
  return sections;
}

function splitSection(
  tree: FilterTree,
  section: FilterSection,
): {
  vault: VaultCondition[];
  stranded: FilterLocation[];
  engine: Composed | null;
} {
  const vault: VaultCondition[] = [];
  const stranded: FilterLocation[] = [];
  const at = <T extends FilterLeaf & Partial<ConditionLeaf>>(
    composed: ComposedFilter<T>,
  ): Composed => ({
    text: composed.text,
    leaves: composed.leaves.map((leaf) => ({
      ...leaf,
      section,
      text: leaf.text ?? composed.text.slice(leaf.from, leaf.to),
      offset: leaf.offset ?? 0,
    })),
  });
  const heldLeaf = (text: string, path: readonly number[]) => {
    const conjuncts = leafConjuncts(text, section, path);
    const kept = conjuncts.filter((conjunct) => {
      if (conjunct.vault) vault.push(conjunct.vault);
      return !conjunct.vault;
    });
    if (kept.length === conjuncts.length)
      return { text, leaves: [{ path, from: 0, to: text.length }] };
    if (kept.length === 0) return null;
    return joinComposed(
      kept.map(({ from, to }) => ({
        text: text.slice(from, to),
        leaves: [{ path, from: 0, to: to - from, text, offset: from }],
      })),
      " && ",
    );
  };
  const strandedLeaves = (composed: ComposedFilter) => {
    for (const { path, from, to } of composed.leaves) {
      const { ast } = parseExpressionAst(composed.text.slice(from, to));
      if (ast !== null && vaultUse(ast, 0).names)
        stranded.push({ section, path });
    }
    return composed;
  };

  if (typeof tree === "string") {
    const engine = heldLeaf(tree, [0]);
    return { vault, stranded, engine: engine && at(engine) };
  }
  const [kind, entries] = filterGroup(tree);
  if (kind !== "and")
    return {
      vault,
      stranded,
      engine: at(strandedLeaves(composeFilterTree(tree))),
    };
  const kept = entries.flatMap((entry, index) => {
    if (typeof entry === "string") {
      const composed = heldLeaf(entry, [index]);
      return composed === null ? [] : [composed];
    }
    const { text, leaves } = composeFilterTree(entry);
    return [
      strandedLeaves({
        text,
        leaves: leaves.map((leaf) => ({
          ...leaf,
          path: [index, ...leaf.path],
        })),
      }),
    ];
  });
  if (vault.length === 0)
    return { vault, stranded, engine: at(composeFilterTree(tree)) };
  return {
    vault,
    stranded,
    engine: kept.length === 0 ? null : at(joinComposed(kept, " && ")),
  };
}

function leafConjuncts(
  text: string,
  section: FilterSection,
  path: readonly number[],
): Conjunct[] {
  const { ast } = parseExpressionAst(text);
  if (ast === null) return [{ from: 0, to: text.length, vault: undefined }];
  const operands = (node: ExpressionNode): ExpressionNode[] =>
    node.type === "group"
      ? operands(node.expression)
      : node.type === "binary" && node.operator === "&&"
        ? [...operands(node.left), ...operands(node.right)]
        : [node];
  return operands(ast).map((node) => {
    const { from, to } = node;
    const use = vaultUse(node, from);
    return {
      from,
      to,
      vault: use.names
        ? {
            section,
            path,
            text: text.slice(from, to),
            reads: use.reads,
            within: { text, offset: from },
          }
        : undefined,
    };
  });
}

function vaultUse(
  node: ExpressionNode,
  offset: number,
): { names: boolean; reads: VaultRead[] | null } {
  const reads: VaultRead[] = [];
  let names = false;
  const isVault = (node: ExpressionNode) =>
    node.type === "identifier" && node.name === "vault";
  const read = (name: string, { from, to }: ExpressionNode) => {
    names = true;
    reads.push({ name, from: from - offset, to: to - offset });
    return true;
  };
  const all = (nodes: readonly ExpressionNode[]) =>
    nodes.map(visit).every(Boolean);
  const visit = (node: ExpressionNode): boolean => {
    switch (node.type) {
      case "identifier":
        if (node.name === "vault") names = true;
        return false;
      case "object-access":
        return isVault(node.object)
          ? read(node.property, node)
          : visit(node.object);
      case "array-access":
        if (isVault(node.object) && node.index.type === "string")
          return read(node.index.value, node);
        return all([node.object, node.index]);
      case "binary":
        return all([node.left, node.right]);
      case "unary":
        return visit(node.operand);
      case "call":
        if (node.callee.type === "identifier") {
          if (node.callee.name === "vault") names = true;
          return all(node.args);
        }
        return all([node.callee, ...node.args]);
      case "array":
        return all(node.elements);
      case "group":
        return visit(node.expression);
      default:
        return true;
    }
  };
  const alone = visit(node);
  return { names, reads: alone ? reads : null };
}

function withKeys(
  filters: Composed | undefined,
  keys: string | null,
): Composed | undefined {
  if (!keys) return filters;
  const condition = { text: keys, leaves: [] };
  return filters ? joinComposed([filters, condition], "\n&& ") : condition;
}
