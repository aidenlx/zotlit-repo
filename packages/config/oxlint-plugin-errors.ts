import type { AstNode, Rule } from "./oxlint-ast.ts";

const COMPARISONS = new Set(["===", "!==", "==", "!="]);
const STRING_TESTS = new Set(["includes", "startsWith", "endsWith", "match"]);

function isMessage(node: AstNode | null | undefined): boolean {
  return (
    node?.type === "MemberExpression" &&
    !node.computed &&
    node.property?.type === "Identifier" &&
    node.property.name === "message"
  );
}

function outer(node: AstNode): AstNode {
  return node.parent?.type === "ChainExpression" ? node.parent : node;
}

export const noMessageMatch: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Decide a failure by its tag or class, not its message.",
    },
    messages: {
      messageMatch:
        "Test the error's tag, class or `code`, not its `.message`; a capability tag decides an expected Obsidian outcome as a tagged error (policies/events.md, Expected outcomes).",
    },
    schema: [],
  },
  create(context) {
    const report = (node: AstNode) =>
      context.report({ node: node as never, messageId: "messageMatch" });
    return {
      MemberExpression(node) {
        const member = node as unknown as AstNode;
        if (!isMessage(member)) return;
        const self = outer(member);
        const parent:
          | (AstNode & {
              operator?: string;
              left?: AstNode;
              right?: AstNode;
            })
          | null
          | undefined = self.parent;
        if (!parent) return;
        if (
          parent.type === "BinaryExpression" &&
          COMPARISONS.has(parent.operator ?? "")
        )
          return report(parent);
        if (
          parent.type === "MemberExpression" &&
          parent.object === self &&
          parent.property?.type === "Identifier" &&
          STRING_TESTS.has(parent.property.name as string)
        ) {
          const call = outer(parent).parent;
          if (call?.type === "CallExpression") return report(call);
        }
        if (
          parent.type === "CallExpression" &&
          parent.arguments?.[0] === self &&
          parent.callee?.type === "MemberExpression" &&
          parent.callee.property?.type === "Identifier" &&
          parent.callee.property.name === "test"
        )
          return report(parent);
      },
    };
  },
};

export default {
  meta: { name: "zotlit-errors" },
  rules: { "no-message-match": noMessageMatch },
};
