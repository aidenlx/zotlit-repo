import type { SyntaxNode, Tree } from "@lezer/common";

import { parseExpression, parser } from "./index.ts";
import type { ExpressionSyntaxError } from "./index.ts";

interface Positioned {
  from: number;
  to: number;
}

export type BinaryOperator =
  | "||"
  | "&&"
  | "=="
  | "!="
  | "<="
  | ">="
  | "<"
  | ">"
  | "+"
  | "-"
  | "*"
  | "/"
  | "%";

export type ExpressionNode =
  | (Positioned & {
      type: "binary";
      operator: BinaryOperator;
      left: ExpressionNode;
      right: ExpressionNode;
    })
  | (Positioned & {
      type: "unary";
      operator: "!" | "-";
      operand: ExpressionNode;
    })
  | (Positioned & {
      type: "call";
      callee: ExpressionNode;
      args: ExpressionNode[];
    })
  | (Positioned & {
      type: "array-access";
      object: ExpressionNode;
      index: ExpressionNode;
    })
  | (Positioned & {
      type: "object-access";
      object: ExpressionNode;
      property: string;
    })
  | (Positioned & { type: "identifier"; name: string })
  | (Positioned & { type: "null" })
  | (Positioned & { type: "boolean"; value: boolean })
  | (Positioned & { type: "number"; value: number })
  | (Positioned & { type: "string"; value: string })
  | (Positioned & { type: "regexp"; source: string; flags: string })
  | (Positioned & { type: "array"; elements: ExpressionNode[] })
  | (Positioned & { type: "group"; expression: ExpressionNode });

export type ParseExpressionAstResult =
  | { ast: ExpressionNode; error: null }
  | { ast: null; error: ExpressionSyntaxError };

export function parseExpressionAst(input: string): ParseExpressionAstResult {
  const { tree, error } = parseExpression(input);
  if (error) return { ast: null, error };
  return { ast: toAst(tree, input), error: null };
}

export function toAst(tree: Tree, input: string): ExpressionNode {
  const expression = tree.topNode.firstChild;
  if (!expression) throw new Error("Empty expression");
  return convert(expression, input, false);
}

class Incomplete extends Error {}

export function parsePartialExpressionAst(
  input: string,
  { typing }: { typing?: Positioned } = {},
): ExpressionNode | null {
  try {
    const [expression] = childrenOf(parser.parse(input).topNode, true);
    return expression ? convert(expression, input, typing ?? true) : null;
  } catch (thrown) {
    if (thrown instanceof Incomplete) return null;
    throw thrown;
  }
}

function convert(
  node: SyntaxNode | undefined,
  input: string,
  partial: boolean | Positioned,
): ExpressionNode {
  if (!node) throw new Incomplete();
  const { from, to } = node;
  const children = (parent: SyntaxNode) =>
    childrenOf(parent, partial !== false);
  const convertChild = (child: SyntaxNode | undefined) =>
    convert(child, input, partial);
  const text = () => input.slice(from, to);
  switch (node.name) {
    case "LogicalExpression":
    case "EqualityExpression":
    case "RelationalExpression":
    case "AdditiveExpression":
    case "MultiplicativeExpression": {
      const [left, operator, right] = children(node);
      return {
        type: "binary",
        operator: input.slice(operator!.from, operator!.to) as BinaryOperator,
        left: convertChild(left),
        right: convertChild(right),
        from,
        to,
      };
    }
    case "UnaryExpression": {
      const [operator, operand] = children(node);
      return {
        type: "unary",
        operator: input.slice(operator!.from, operator!.to) as "!" | "-",
        operand: convertChild(operand),
        from,
        to,
      };
    }
    case "Call": {
      const [callee, ...rest] = children(node);
      return {
        type: "call",
        callee: convertChild(callee),
        args: rest.filter(isExpression).map((arg) => convertChild(arg)),
        from,
        to,
      };
    }
    case "ArrayAccess": {
      const [object, , index] = children(node);
      return {
        type: "array-access",
        object: convertChild(object),
        index: convertChild(index),
        from,
        to,
      };
    }
    case "ObjectAccess": {
      const [object, , property] = children(node);
      if (
        !property ||
        (typeof partial === "object" && typingOff(node, object!, partial))
      )
        return convertChild(object);
      return {
        type: "object-access",
        object: convertChild(object),
        property: input.slice(property.from, property.to),
        from,
        to,
      };
    }
    case "Identifier":
      return { type: "identifier", name: text(), from, to };
    case "NullLiteral":
      return { type: "null", from, to };
    case "BooleanLiteral":
      return { type: "boolean", value: text() === "true", from, to };
    case "RealNumber":
      return { type: "number", value: Number(text()), from, to };
    case "String":
      return { type: "string", value: unquote(text()), from, to };
    case "RegExp": {
      const source = text();
      const end = source.lastIndexOf("/");
      return {
        type: "regexp",
        source: source.slice(1, end),
        flags: source.slice(end + 1),
        from,
        to,
      };
    }
    case "Array":
      return {
        type: "array",
        elements: children(node)
          .filter(isExpression)
          .map((element) => convertChild(element)),
        from,
        to,
      };
    case "GroupedExpression": {
      const [, expression] = children(node);
      return {
        type: "group",
        expression: convertChild(expression),
        from,
        to,
      };
    }
    default:
      throw new Error(`Unexpected node ${node.name}`);
  }
}

function typingOff(
  access: SyntaxNode,
  object: SyntaxNode,
  typing: Positioned,
): boolean {
  if (object.from !== typing.from || object.to !== typing.to) return false;
  const call = access.parent;
  return !(call?.name === "Call" && call.firstChild?.from === access.from);
}

function childrenOf(node: SyntaxNode, partial: boolean): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (partial && child.type.isError) {
      if (child.from < child.to) throw new Incomplete();
      continue;
    }
    result.push(child);
  }
  return result;
}

const PUNCTUATION = new Set(["(", ")", "[", "]", ",", "."]);

function isExpression(node: SyntaxNode): boolean {
  return !PUNCTUATION.has(node.name);
}

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r" };

function unquote(literal: string): string {
  const body = literal.slice(1, -1);
  let result = "";
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (char !== "\\" || i + 1 >= body.length) {
      result += char;
      continue;
    }
    const next = body[++i]!;
    result += ESCAPES[next] ?? next;
  }
  return result;
}

export function isIdentifierName(name: string): boolean {
  const { ast } = parseExpressionAst(name);
  return ast?.type === "identifier" && ast.name === name;
}

export function isMemberName(name: string): boolean {
  const { ast } = parseExpressionAst(`x.${name}`);
  return ast?.type === "object-access" && ast.property === name;
}
