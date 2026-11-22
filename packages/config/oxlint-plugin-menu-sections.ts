import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

export const noLiteralMenuSection: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require menu section names from a registered list.",
    },
    messages: {
      literal:
        'Take the section from MENU_SECTION (@zotlit/plugin-kernel/menu-section.ts) or menuSections(…) (@zotlit/obsidian-kit/menu-events.ts); a section the menu never registered sorts below "Delete".',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        if (
          callee.type !== "MemberExpression" ||
          callee.property.type !== "Identifier" ||
          callee.property.name !== "setSection"
        )
          return;
        const [section] = node.arguments;
        if (
          (section?.type === "Literal" && typeof section.value === "string") ||
          (section?.type === "TemplateLiteral" &&
            section.expressions.length === 0)
        )
          context.report({ node: section, messageId: "literal" });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-menu" },
  rules: { "no-literal-section": noLiteralMenuSection },
};
