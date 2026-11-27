import type { ESTree } from "vite";

type Node = ESTree.Node;
type Pattern = Node | null;

export interface Binding {
  readonly name: string;
  readonly init?: ESTree.Expression | null;
}

export type Resolve = (name: string) => Binding | undefined;

const FUNCTIONS = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

const isNode = (value: unknown): value is Node =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { type?: unknown }).type === "string";

const childrenOf = (node: Node) =>
  Object.values(node).flatMap((value: unknown) =>
    (Array.isArray(value) ? value : [value]).filter(isNode),
  );

export function patternNames(pattern: Pattern | undefined): string[] {
  switch (pattern?.type) {
    case "Identifier":
      return [pattern.name];
    case "ObjectPattern":
      return pattern.properties.flatMap((property) =>
        patternNames(
          property.type === "RestElement" ? property.argument : property.value,
        ),
      );
    case "ArrayPattern":
      return pattern.elements.flatMap((element) => patternNames(element));
    case "AssignmentPattern":
      return patternNames(pattern.left);
    case "RestElement":
      return patternNames(pattern.argument);
    default:
      return [];
  }
}

function declare(
  scope: Map<string, Binding>,
  declaration: ESTree.VariableDeclaration,
) {
  for (const { id, init } of declaration.declarations)
    for (const name of patternNames(id))
      scope.set(
        name,
        id.type === "Identifier" ? { name, init: init ?? null } : { name },
      );
}

function lexical(scope: Map<string, Binding>, statements: readonly Node[]) {
  for (const statement of statements) {
    const node =
      (statement.type === "ExportNamedDeclaration" ||
        statement.type === "ExportDefaultDeclaration") &&
      isNode(statement.declaration)
        ? statement.declaration
        : statement;
    if (node.type === "VariableDeclaration" && node.kind !== "var")
      declare(scope, node);
    else if (
      (node.type === "FunctionDeclaration" ||
        node.type === "ClassDeclaration") &&
      node.id
    )
      scope.set(node.id.name, { name: node.id.name });
    else if (node.type === "ImportDeclaration")
      for (const { local } of node.specifiers)
        scope.set(local.name, { name: local.name });
  }
}

function hoisted(scope: Map<string, Binding>, node: Node) {
  for (const child of childrenOf(node)) {
    if (FUNCTIONS.has(child.type)) continue;
    if (child.type === "VariableDeclaration" && child.kind === "var")
      declare(scope, child);
    hoisted(scope, child);
  }
}

function bindingsOf(node: Node): Map<string, Binding> {
  const scope = new Map<string, Binding>();
  const names = (pattern: Pattern | undefined) => {
    for (const name of patternNames(pattern)) scope.set(name, { name });
  };
  switch (node.type) {
    case "Program":
      lexical(scope, node.body);
      hoisted(scope, node);
      break;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      if (node.type === "FunctionExpression") names(node.id);
      for (const param of node.params) names(param);
      if (node.body) hoisted(scope, node.body);
      break;
    case "BlockStatement":
    case "StaticBlock":
      lexical(scope, node.body);
      break;
    case "SwitchStatement":
      lexical(
        scope,
        node.cases.flatMap((each) => each.consequent),
      );
      break;
    case "CatchClause":
      names(node.param);
      break;
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement": {
      const head = node.type === "ForStatement" ? node.init : node.left;
      if (head?.type === "VariableDeclaration" && head.kind !== "var")
        declare(scope, head);
      break;
    }
    case "ClassExpression":
      names(node.id);
      break;
  }
  return scope;
}

export interface Step {
  readonly node: Node;
  readonly parent: Node | undefined;
  readonly key: string;
  readonly resolve: Resolve;
}

export function walkScopes(
  program: ESTree.Program,
  enter: (step: Step) => void,
) {
  const scopes = new WeakMap<Node, Map<string, Binding>>();
  const ancestors: Node[] = [];
  const resolve: Resolve = (name) => {
    for (let index = ancestors.length - 1; index >= 0; index--) {
      const node = ancestors[index]!;
      let scope = scopes.get(node);
      if (!scope) scopes.set(node, (scope = bindingsOf(node)));
      const binding = scope.get(name);
      if (binding) return binding;
    }
    return undefined;
  };
  const visit = (node: Node, parent: Node | undefined, key: string) => {
    ancestors.push(node);
    enter({ node, parent, key, resolve });
    for (const [childKey, value] of Object.entries(node))
      for (const child of Array.isArray(value) ? value : [value])
        if (isNode(child)) visit(child, node, childKey);
    ancestors.pop();
  };
  visit(program, undefined, "");
}
