import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];
type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type Node =
  | Parameters<NonNullable<Visitor["Literal"]>>[0]
  | Parameters<NonNullable<Visitor["TemplateElement"]>>[0];

function isObsidianClass(name: string): boolean {
  return (
    name === "clickable-icon" ||
    name === "mod-cta" ||
    name === "mod-warning" ||
    name.startsWith("setting-item")
  );
}

const wordClasses = new Set(["dropdown", "slider"]);

const widgetPrefixes = ["bases-", "metadata-", "multi-select-"];

const classListCalls = new Set(["cn", "tv", "clsx"]);

function inClassList(node: Node): boolean {
  for (let at: Node["parent"] | null = node.parent; at; at = at.parent) {
    if (
      at.type === "JSXAttribute" &&
      at.name.type === "JSXIdentifier" &&
      at.name.name === "className"
    )
      return true;
    if (
      at.type === "CallExpression" &&
      at.callee.type === "Identifier" &&
      classListCalls.has(at.callee.name)
    )
      return true;
  }
  return false;
}

export const noObsidianClass: Rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Reach Obsidian's control classes through @zotlit/obsidian-kit/components/obsidian.",
    },
    messages: {
      obsidianClass:
        'Draw "{{name}}" with zt: utilities over Obsidian\'s variables, or use the wrapper in packages/obsidian-kit/src/components/obsidian/ (see the obsidian-css skill).',
    },
    schema: [],
  },
  create(context) {
    const check = (node: Node, text: string) => {
      for (const name of text.split(/\s+/))
        if (
          isObsidianClass(name) ||
          ((wordClasses.has(name) ||
            widgetPrefixes.some((prefix) => name.startsWith(prefix))) &&
            inClassList(node))
        )
          context.report({ node, messageId: "obsidianClass", data: { name } });
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? "");
      },
    };
  },
};

export const noSettingInReact: Rule = {
  meta: {
    type: "suggestion",
    docs: { description: "Build form rows in React from JSX." },
    messages: {
      setting:
        "Build the row in JSX: a label, the control from packages/obsidian-kit/src/components/obsidian/, and zt: utilities (see the obsidian-css skill).",
    },
    schema: [],
  },
  create(context) {
    return {
      NewExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "Setting")
          context.report({ node, messageId: "setting" });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-css" },
  rules: {
    "no-obsidian-class": noObsidianClass,
    "no-setting-in-react": noSettingInReact,
  },
};
