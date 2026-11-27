import type { SyntaxNode } from "@lezer/common";

import { METHOD_ENTRIES, PROPERTY_ENTRIES } from "@zotlit/item-query";
import type {
  FilterValueType,
  FunctionDefinition,
  PropertyDefinition,
} from "@zotlit/item-query";

import type {
  Caret,
  ExpressionCompletionResult,
  ExpressionOption,
  ExpressionReceiver,
  ExpressionVocabulary,
} from "./expression-options.ts";
import {
  fieldOption,
  rankedOptions,
  signature,
  takesArguments,
} from "./expression-options.ts";

type Entry = readonly [
  FilterValueType | "any",
  string,
  FunctionDefinition | PropertyDefinition,
];

const METHODS_BY_NAME = Map.groupBy<string, Entry>(
  METHOD_ENTRIES,
  ([, name]) => name,
);
const PROPERTIES_BY_NAME = Map.groupBy<string, Entry>(
  PROPERTY_ENTRIES,
  ([, name]) => name,
);
const NAMESPACES = new Set(["this", "formula", "vault"]);

function memberOption(
  kind: "method" | "property",
  name: string,
  definitions: readonly (FunctionDefinition | PropertyDefinition)[],
): ExpressionOption {
  const returns = [
    ...new Set(definitions.map((definition) => definition.returns ?? "any")),
  ].join(" | ");
  const note = definitions[0]!.description;
  if (kind === "property")
    return { label: name, insert: name, kind, type: returns, note };
  return {
    label: name,
    insert: `${name}()`,
    caret: name.length + 1,
    kind,
    type: signature(name, {
      parameters: [],
      ...(definitions as FunctionDefinition[]).find(takesArguments),
      returns: returns as FunctionDefinition["returns"],
    }),
    note,
  };
}

function memberEntries(
  receiver: ExpressionReceiver | undefined,
): ExpressionOption[] {
  const type = receiver?.type;
  const fitting = (
    kind: "method" | "property",
    byName: ReadonlyMap<string, readonly Entry[]>,
  ) =>
    [...byName].flatMap(([name, entries]) => {
      const applying = entries.filter(
        ([of]) =>
          type === undefined ||
          of === type ||
          (kind === "method" && of === "any"),
      );
      return applying.length === 0
        ? []
        : [
            memberOption(
              kind,
              name,
              applying.map(([, , d]) => d),
            ),
          ];
    });
  return [
    ...(receiver?.members ?? []).map(fieldOption),
    ...fitting("property", PROPERTIES_BY_NAME),
    ...fitting("method", METHODS_BY_NAME),
  ];
}

function memberAccessAt({
  inner,
  pos,
  source,
}: Caret): { receiver: SyntaxNode; from: number; to: number } | null {
  for (let node: SyntaxNode | null = inner; node; node = node.parent) {
    if (node.name !== "ObjectAccess") continue;
    const dot = node.getChild(".");
    const receiver = node.firstChild;
    if (!dot || !receiver || dot.to > pos) return null;
    const name = node.getChild("PropertyName");
    if (name)
      return name.from <= pos && pos <= name.to
        ? { receiver, from: name.from, to: name.to }
        : null;
    return source.slice(dot.to, pos).trim() === ""
      ? { receiver, from: pos, to: pos }
      : null;
  }
  return null;
}

export function namespaceAccessAt(caret: Caret): {
  namespace: string;
  typed: string;
  from: number;
  to: number;
} | null {
  const access = memberAccessAt(caret);
  if (!access) return null;
  const { receiver } = access;
  const { pos, source } = caret;
  const namespace = source.slice(receiver.from, receiver.to);
  if (!isNamespace(receiver, namespace)) return null;
  return {
    namespace,
    typed: source.slice(access.from, pos),
    from: receiver.from,
    to: access.to,
  };
}

const isNamespace = (receiver: SyntaxNode, text: string) =>
  receiver.name === "Identifier" && NAMESPACES.has(text);

export function memberCompletions(
  caret: Caret,
  vocabulary: ExpressionVocabulary,
): ExpressionCompletionResult | null | undefined {
  const access = memberAccessAt(caret);
  const { pos, source } = caret;
  if (!access) return undefined;
  const { receiver } = access;
  const text = source.slice(receiver.from, receiver.to);
  if (isNamespace(receiver, text)) return undefined;
  const options = rankedOptions(
    memberEntries(
      vocabulary.receiver?.(source, { from: receiver.from, to: receiver.to }),
    ),
    source.slice(access.from, pos),
  );
  return options.length === 0
    ? null
    : { from: access.from, to: access.to, options };
}
