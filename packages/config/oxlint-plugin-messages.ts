import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];
type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type Member = Parameters<NonNullable<Visitor["MemberExpression"]>>[0];

const FACADE =
  /(?:^@zotlit\/[\w-]+-messages\/messages\.ts|\/paraglide\/messages(?:\.js)?)$/;

type Wrapped = Member["object"] | Member["property"];

function unwrapped<T extends Wrapped>(node: T): T {
  let current: Wrapped = node;
  while (
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSNonNullExpression" ||
    current.type === "ParenthesizedExpression"
  )
    current = current.expression;
  return current as T;
}

function staticKey(property: Member["property"]): boolean {
  const node = unwrapped(property);
  if (node.type === "Literal") return typeof node.value === "string";
  return node.type === "TemplateLiteral" && node.expressions.length === 0;
}

export const noComputedMessage: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Report a message of the generated facade looked up by a computed key.",
    },
    schema: [],
    messages: {
      computed:
        "`{{name}}[…]` keeps every message of the facade in the bundle. Look the key up in a static table of message functions, such as `const LABELS = { key: {{name}}.key }`, or call `{{name}}.key()` by name.",
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (!node.computed || staticKey(node.property)) return;
        const object = unwrapped(node.object);
        if (object.type !== "Identifier") return;
        for (
          let scope = context.sourceCode.getScope(node);
          scope;
          scope = scope.upper!
        ) {
          const variable = scope.set.get(object.name);
          if (!variable) continue;
          const definition = variable.defs[0];
          if (
            definition?.node.type === "ImportNamespaceSpecifier" &&
            definition.parent?.type === "ImportDeclaration" &&
            FACADE.test(String(definition.parent.source.value))
          )
            context.report({
              node,
              messageId: "computed",
              data: { name: object.name },
            });
          return;
        }
      },
    };
  },
};

export default {
  meta: { name: "zotlit-messages" },
  rules: { "no-computed-message": noComputedMessage },
};
