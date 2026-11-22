import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];
type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type CallNode = Parameters<NonNullable<Visitor["CallExpression"]>>[0];

const trackerReference =
  /aidenlx\/zotlit[\w.-]*(?:\/(?:issues|pull|discussions)\/\d+|#\d+)|(?<![\w&/#[=:"'-])#[1-9]\d{1,4}\b(?![\da-fA-F;])|\b(?:issues?|PRs?|pull requests?)\s+#?\d{2,5}\b/i;

function findReference(text: string): string | undefined {
  return trackerReference.exec(text.replaceAll(/`[^`\n]*`/g, "``"))?.[0];
}

const testFunctions = new Set(["describe", "it", "test", "suite"]);

function testCallee(callee: CallNode["callee"]): boolean {
  let at: CallNode["callee"] = callee;
  for (;;) {
    if (at.type === "Identifier") return testFunctions.has(at.name);
    if (at.type === "MemberExpression") at = at.object;
    else if (at.type === "CallExpression") at = at.callee;
    else return false;
  }
}

export const noTrackerReference: Rule = {
  meta: {
    type: "suggestion",
    messages: {
      comment:
        "Write the reason in this comment. `{{reference}}` binds it to the issue tracker.",
      name: "Name what this test proves. `{{reference}}` binds the name to the issue tracker.",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const reference = findReference(comment.value);
          if (reference)
            context.report({
              loc: comment.loc,
              messageId: "comment",
              data: { reference },
            });
        }
      },
      CallExpression(node) {
        if (!testCallee(node.callee)) return;
        const name = node.arguments[0];
        const text =
          name?.type === "Literal" && typeof name.value === "string"
            ? name.value
            : name?.type === "TemplateLiteral"
              ? name.quasis.map((quasi) => quasi.value.raw).join("")
              : undefined;
        const reference = text === undefined ? undefined : findReference(text);
        if (name && reference)
          context.report({
            node: name,
            messageId: "name",
            data: { reference },
          });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-comments" },
  rules: { "no-tracker-reference": noTrackerReference },
};
