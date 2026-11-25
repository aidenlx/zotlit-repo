import { isBuiltin } from "node:module";
import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];
type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type SourceNode = Parameters<NonNullable<Visitor["ImportExpression"]>>[0];
type Source = SourceNode["source"] | null | undefined;

function staticSource(node: Source): string | undefined {
  if (node?.type === "Literal" && typeof node.value === "string")
    return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw;
  return undefined;
}

export const noNodeBuiltin: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Report an import of a Node built-in module in a file whose runtime has no Node.",
    },
    messages: { builtin: "`{{name}}` is a Node built-in module. {{message}}" },
    schema: [
      {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const { message } = context.options[0] as { message: string };
    const check = (source: Source) => {
      const name = staticSource(source);
      if (name !== undefined && isBuiltin(name) && source)
        context.report({
          node: source,
          messageId: "builtin",
          data: { name, message },
        });
    };
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      CallExpression: (node) => {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments.length === 1
        )
          check(node.arguments[0] as Source);
      },
    };
  },
};

export default {
  meta: { name: "zotlit-runtime" },
  rules: { "no-node-builtin": noNodeBuiltin },
};
