import type { ESTree } from "vite";

import type { Runtime } from "@zotlit/scripts/runtime-table";

import { patternNames, walkScopes } from "./worker-scope.ts";
import type { Binding, Resolve } from "./worker-scope.ts";

type Node = ESTree.Expression | ESTree.Super | ESTree.Argument;

const GLOBAL_SCOPES = new Set(["globalThis", "self"]);

const literalOf = (node: Node | undefined) =>
  node?.type === "Literal" && typeof node.value === "string"
    ? node.value
    : node?.type === "TemplateLiteral" && node.expressions.length === 0
      ? (node.quasis[0]!.value.cooked ?? undefined)
      : undefined;

function nameOf(callee: Node): string | undefined {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type !== "MemberExpression") return undefined;
  if (callee.computed) return literalOf(callee.property);
  return callee.property.type === "Identifier"
    ? callee.property.name
    : undefined;
}

const isGlobalRequire = (callee: Node) =>
  callee.type === "Identifier"
    ? callee.name === "require"
    : callee.type === "MemberExpression" &&
      callee.object.type === "Identifier" &&
      GLOBAL_SCOPES.has(callee.object.name) &&
      nameOf(callee) === "require";

const NAME_KEYS: Readonly<Record<string, readonly string[]>> = {
  MemberExpression: ["property"],
  Property: ["key"],
  MethodDefinition: ["key"],
  PropertyDefinition: ["key"],
  AccessorProperty: ["key"],
  LabeledStatement: ["label"],
  BreakStatement: ["label"],
  ContinueStatement: ["label"],
  ImportSpecifier: ["imported"],
  ExportSpecifier: ["exported"],
  ExportAllDeclaration: ["exported"],
  MetaProperty: ["meta", "property"],
  ImportAttribute: ["key"],
};

const isReference = (parent: ESTree.Node | undefined, key: string) =>
  !parent ||
  !NAME_KEYS[parent.type]?.includes(key) ||
  ("computed" in parent && parent.computed === true);

export interface LoadRule {
  readonly runtime: Runtime;
  readonly scriptUrlGlobal?: string;
}

export function checkLoads(
  program: ESTree.Program,
  { runtime, scriptUrlGlobal }: LoadRule,
): string[] {
  const failures = new Set<string>();
  const noModules = runtime.modules.length === 0;
  const given = (id: string | undefined, what: string) => {
    if (id === undefined)
      failures.add(
        `worker.js ${what} a computed name, which the bundle check cannot hold to ${runtime.title}`,
      );
    else if (!runtime.modules.includes(id))
      failures.add(
        `worker.js ${what} "${id}", which ${runtime.title} does not give`,
      );
  };
  const refersToRequire = (
    call: ESTree.Node | undefined,
    callee: ESTree.Node,
  ) => {
    const id =
      call?.type === "CallExpression" && call.callee === callee
        ? literalOf(call.arguments[0])
        : undefined;
    failures.add(
      id === undefined
        ? `worker.js refers to require, which ${runtime.title} does not give`
        : `worker.js requires "${id}", which ${runtime.title} does not give`,
    );
  };
  const writes = new Map<Binding, boolean[]>();
  const write = (binding: Binding | undefined, ofGlobal: boolean) => {
    if (binding)
      writes.set(binding, [...(writes.get(binding) ?? []), ofGlobal]);
  };
  const isFreeGlobal = (node: Node | null | undefined, resolve: Resolve) =>
    node?.type === "Identifier" &&
    GLOBAL_SCOPES.has(node.name) &&
    resolve(node.name) === undefined;
  const pending: {
    readonly binding: Binding;
    readonly ifAlias?: () => void;
    readonly ifOther?: () => void;
  }[] = [];
  const onGlobal = (
    node: Node,
    resolve: Resolve,
    then: { readonly ifAlias?: () => void; readonly ifOther?: () => void },
  ) => {
    if (isFreeGlobal(node, resolve)) return then.ifAlias?.();
    const binding = node.type === "Identifier" ? resolve(node.name) : undefined;
    if (binding) pending.push({ binding, ...then });
    else then.ifOther?.();
  };
  const scriptsFailure = () =>
    failures.add(
      `worker.js calls importScripts with another URL than the global ${scriptUrlGlobal ?? "(none)"}`,
    );

  walkScopes(program, ({ node, parent, key, resolve }) => {
    switch (node.type) {
      case "ImportExpression":
        return given(literalOf(node.source), "imports");
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportAllDeclaration":
        if (node.source) given(literalOf(node.source), "imports");
        return;
      case "AssignmentExpression":
        if (node.left.type === "Identifier")
          write(
            resolve(node.left.name),
            node.operator === "=" && isFreeGlobal(node.right, resolve),
          );
        else
          for (const name of patternNames(node.left))
            write(resolve(name), false);
        return;
      case "UpdateExpression":
        if (node.argument.type === "Identifier")
          write(resolve(node.argument.name), false);
        return;
      case "ForInStatement":
      case "ForOfStatement":
        if (node.left.type !== "VariableDeclaration")
          for (const name of patternNames(node.left))
            write(resolve(name), false);
        return;
      case "Identifier":
        if (
          noModules &&
          node.name === "require" &&
          isReference(parent, key) &&
          !(
            parent?.type === "UnaryExpression" && parent.operator === "typeof"
          ) &&
          resolve("require") === undefined
        )
          refersToRequire(parent, node);
        return;
      case "MemberExpression":
        if (noModules && nameOf(node) === "require")
          onGlobal(node.object, resolve, {
            ifAlias: () => refersToRequire(parent, node),
          });
        return;
      case "CallExpression":
        if (!noModules && isGlobalRequire(node.callee)) {
          const id = literalOf(node.arguments[0]);
          if (id === undefined) given(id, "requires");
        } else if (nameOf(node.callee) === "importScripts") {
          const [url, ...rest] = node.arguments;
          if (
            scriptUrlGlobal === undefined ||
            rest.length > 0 ||
            url?.type !== "MemberExpression" ||
            nameOf(url) !== scriptUrlGlobal
          )
            return scriptsFailure();
          onGlobal(url.object, resolve, { ifOther: scriptsFailure });
        }
    }
  });
  for (const { binding, ifAlias, ifOther } of pending) {
    const assigned = writes.get(binding) ?? [];
    const alias =
      binding.init !== undefined &&
      (binding.init === null
        ? assigned.length > 0
        : binding.init.type === "Identifier" &&
          GLOBAL_SCOPES.has(binding.init.name)) &&
      assigned.every(Boolean);
    (alias ? ifAlias : ifOther)?.();
  }
  return [...failures];
}
