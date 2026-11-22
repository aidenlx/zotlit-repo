import obsidianmd from "eslint-plugin-obsidianmd";

const typeAware = new Set([
  "no-plugin-as-component",
  "no-unsupported-api",
  "no-view-references-in-plugin",
  "prefer-create-el",
  "prefer-file-manager-trash-file",
  "prefer-instanceof",
]);

type Rule = NonNullable<(typeof obsidianmd.rules)[string]>;

function reportOnly(rule: Rule): Rule {
  return {
    ...rule,
    meta: { ...rule.meta, fixable: undefined },
    create: (context) =>
      rule.create(
        new Proxy({} as typeof context, {
          get: (_, key) =>
            key === "report"
              ? (report: { fix?: unknown }) =>
                  context.report({ ...report, fix: undefined } as never)
              : Reflect.get(context, key, context),
        }),
      ),
  };
}

const rules: Record<string, Rule> = {};
for (const [name, rule] of Object.entries(obsidianmd.rules)) {
  if (rule && !typeAware.has(name)) rules[name] = rule;
}
rules["no-global-this"] = reportOnly(rules["no-global-this"]!);

const restrictedGlobals: Record<string, string> = {
  app: "Avoid using the global app object. Instead use the reference provided by your plugin instance.",
  fetch:
    "Use the built-in `requestUrl` function instead of `fetch` for network requests in Obsidian.",
  localStorage:
    "Prefer `App#saveLocalStorage` / `App#loadLocalStorage` functions to write / read localStorage data that's unique to a vault.",
};

function isReference(node: any): boolean {
  const parent = node.parent;
  if (!parent) return true;
  if (parent.type === "MemberExpression")
    return parent.property !== node || parent.computed;
  if (
    parent.type === "Property" ||
    parent.type === "PropertyDefinition" ||
    parent.type === "MethodDefinition"
  )
    return (
      parent.key !== node ||
      parent.computed ||
      (parent.shorthand && parent.value === node)
    );
  return !parent.type.startsWith("TS");
}

function isDeclared(scope: any, name: string): boolean {
  for (let current = scope; current; current = current.upper) {
    const variable = current.variables.find((v: any) => v.name === name);
    if (variable && variable.defs.length > 0) return true;
  }
  return false;
}

rules["no-restricted-globals"] = {
  meta: {
    type: "suggestion",
    schema: [],
    messages: { restricted: "Unexpected use of '{{name}}'. {{message}}" },
  },
  create: (context: any) => ({
    Identifier(node: any) {
      const message = restrictedGlobals[node.name];
      if (message === undefined || !isReference(node)) return;
      if (isDeclared(context.sourceCode.getScope(node), node.name)) return;
      context.report({
        node,
        messageId: "restricted",
        data: { name: node.name, message },
      });
    },
  }),
} as unknown as Rule;

export default { meta: { name: "obsidianmd" }, rules };
