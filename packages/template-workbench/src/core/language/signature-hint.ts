import type { SyntaxNode } from "@lezer/common";

import { parser } from "@zotlit/filter-expression";
import {
  GLOBAL_FUNCTIONS,
  IF_FUNCTION,
  METHOD_ENTRIES,
  parameterAt,
  parameterTexts,
  parameterTypeText,
  resultText,
} from "@zotlit/item-query";
import type { FilterValueType, FunctionDefinition } from "@zotlit/item-query";

import type { ExpressionReceiver } from "./expression-options.ts";
import type { Span } from "./span.ts";

export interface HintParameter {
  readonly name: string;
  readonly type: string;
  readonly optional: boolean;
  readonly rest: boolean;
  readonly text: string;
}

export interface HintSignature {
  readonly receiver: FilterValueType | "any" | null;
  readonly parameters: readonly HintParameter[];
  readonly active: number;
  readonly returns: string;
  readonly description: string;
}

export interface SignatureHintResult {
  readonly callee: string;
  readonly open: number;
  readonly signatures: readonly HintSignature[];
}

export interface SignatureHintOptions {
  readonly receiver?: (
    source: string,
    at: Span,
  ) => Pick<ExpressionReceiver, "type"> | undefined;
}

type Definition = Pick<
  FunctionDefinition,
  "description" | "parameters" | "optional" | "rest"
> & { readonly returns?: FunctionDefinition["returns"] };

function signature(
  receiver: HintSignature["receiver"],
  definition: Definition,
  argument: number,
): HintSignature {
  const at = parameterAt(definition, argument);
  const parameters = parameterTexts(definition);
  return {
    receiver,
    parameters: parameters.map(({ parameter, optional, rest, text }) => ({
      name: parameter.name,
      type: parameterTypeText(parameter),
      optional,
      rest,
      text,
    })),
    active: parameters.findIndex(({ parameter }) => parameter === at),
    returns: resultText(definition.returns),
    description: definition.description,
  };
}

function callAround(inner: SyntaxNode, pos: number): SyntaxNode | null {
  for (let node: SyntaxNode | null = inner; node; node = node.parent) {
    if (node.name !== "Call") continue;
    const open = node.getChild("(");
    const close = node.getChild(")");
    if (open && open.to <= pos && (!close || pos <= close.from)) return node;
  }
  return null;
}

export function signatureAt(
  text: string,
  pos: number,
  { receiver: receiverOf }: SignatureHintOptions = {},
): SignatureHintResult | null {
  const tree = parser.parse(text);
  const call = callAround(tree.resolveInner(pos, -1), pos);
  if (!call) return null;
  let argument = 0;
  for (let child = call.firstChild; child; child = child.nextSibling)
    if (child.name === "," && child.to <= pos) argument++;
  const open = call.getChild("(")!.from;
  const callee = call.firstChild!;
  if (callee.name === "Identifier") {
    const name = text.slice(callee.from, callee.to);
    const definition = name === "if" ? IF_FUNCTION : GLOBAL_FUNCTIONS.get(name);
    return definition
      ? {
          callee: name,
          open,
          signatures: [signature(null, definition, argument)],
        }
      : null;
  }
  if (callee.name !== "ObjectAccess") return null;
  const name = callee.getChild("PropertyName");
  const receiver = callee.firstChild;
  if (!name || !receiver) return null;
  const method = text.slice(name.from, name.to);
  const named = METHOD_ENTRIES.filter(([, entryName]) => entryName === method);
  const type = receiverOf?.(text, {
    from: receiver.from,
    to: receiver.to,
  })?.type;
  const own =
    named.find(([of]) => of === type) ?? named.find(([of]) => of === "any");
  const chosen = type === undefined ? named : own ? [own] : [];
  if (chosen.length === 0) return null;
  return {
    callee: method,
    open,
    signatures: chosen.map(([of, , definition]) =>
      signature(of, definition, argument),
    ),
  };
}
