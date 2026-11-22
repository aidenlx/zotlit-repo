import type { SyntaxNode } from "@lezer/common";

import { METHOD_ENTRIES } from "@zotlit/item-query";

import type { Caret, ExpressionOption } from "./expression-options.ts";

const BINDS: ReadonlyMap<string, readonly string[]> = new Map(
  METHOD_ENTRIES.flatMap(([, name, method]) =>
    method.scope ? [[name, method.scope] as const] : [],
  ),
);

export const bindsNames = (method: string): boolean => BINDS.has(method);

export function bindingMethod(call: SyntaxNode, source: string): string | null {
  if (call.name !== "Call") return null;
  const callee = call.firstChild;
  const name =
    callee?.name === "ObjectAccess" ? callee.getChild("PropertyName") : null;
  if (!name) return null;
  const method = source.slice(name.from, name.to);
  return BINDS.has(method) ? method : null;
}

export function inFirstArgument(call: SyntaxNode, pos: number): boolean {
  const open = call.getChild("(");
  const close = call.getChild(")");
  return (
    open !== null &&
    open.to <= pos &&
    (close === null || pos <= close.from) &&
    !call.getChildren(",").some((comma) => comma.to <= pos)
  );
}

export function boundNameOptions({
  inner,
  pos,
  source,
}: Caret): ExpressionOption[] {
  const names = new Set<string>();
  for (let node: SyntaxNode | null = inner; node; node = node.parent) {
    const method = bindingMethod(node, source);
    if (method && inFirstArgument(node, pos))
      for (const name of BINDS.get(method)!) names.add(name);
  }
  return [...names].map((name) => ({
    label: name,
    insert: name,
    kind: "variable",
  }));
}
