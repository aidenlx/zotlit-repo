import type { Tree } from "@lezer/common";

import { parser } from "./generated/parser.ts";
import { syntaxFault } from "./syntax-fault.ts";

export { parser };

export interface ExpressionSyntaxError {
  from: number;
  to: number;
  found: string | null;
  expected: readonly string[];
  opened: { from: number; to: number; closer: string } | null;
  span: { from: number; to: number } | null;
}

export interface ParseExpressionResult {
  tree: Tree;
  error: ExpressionSyntaxError | null;
}

export function parseExpression(input: string): ParseExpressionResult {
  const tree = parser.parse(input);
  return { tree, error: hasError(tree) ? syntaxFault(input, tree) : null };
}

function hasError(tree: Tree): boolean {
  const cursor = tree.cursor();
  do {
    if (cursor.type.isError) return true;
  } while (cursor.next());
  return false;
}

export {
  isIdentifierName,
  isMemberName,
  parseExpressionAst,
  parsePartialExpressionAst,
  toAst,
} from "./ast.ts";
export type {
  BinaryOperator,
  ExpressionNode,
  ParseExpressionAstResult,
} from "./ast.ts";

export {
  composeFilterTree,
  FILTER_GROUP_KINDS,
  filterGroup,
  foldFilterTree,
  joinComposed,
  isFilterTree,
  readFilterTree,
} from "./tree.ts";
export type {
  ComposedFilter,
  FilterGroupKind,
  FilterLeaf,
  FilterPath,
  FilterTree,
  FilterTreeFold,
} from "./tree.ts";
