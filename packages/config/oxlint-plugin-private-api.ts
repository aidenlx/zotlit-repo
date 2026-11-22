import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

export const noUnknownCast: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Declare a private Obsidian API in obsidian-ex.d.ts rather than cast to it.",
    },
    messages: {
      unknownCast:
        "Declare this surface as optional in src/typings/obsidian-ex.d.ts and keep the runtime guard, instead of casting through unknown.",
    },
    schema: [],
  },
  create(context) {
    return {
      TSAsExpression(node) {
        const inner = node.expression;
        if (
          inner.type === "TSAsExpression" &&
          inner.typeAnnotation.type === "TSUnknownKeyword"
        )
          context.report({ node, messageId: "unknownCast" });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-private" },
  rules: { "no-unknown-cast": noUnknownCast },
};
