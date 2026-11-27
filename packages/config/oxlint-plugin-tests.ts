import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];
type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type CallNode = Parameters<NonNullable<Visitor["CallExpression"]>>[0];
type Node =
  | Parameters<NonNullable<Visitor["Literal"]>>[0]
  | Parameters<NonNullable<Visitor["TemplateElement"]>>[0];

const ztClass = /(?<![\w-])zt\\*:(?=\S)/;

const classQuery =
  /classList\.contains\(\s*["'`]zt:|\.zt\\+:|\[class[~*^$|]?=\s*["'`]?zt\\*:/;

function isExpectChain(callee: CallNode["callee"]): boolean {
  let at: CallNode["callee"] = callee;
  for (;;) {
    if (at.type === "Identifier") return at.name === "expect";
    if (at.type === "MemberExpression") at = at.object;
    else if (at.type === "CallExpression") at = at.callee;
    else return false;
  }
}

function inAssertion(node: Node): boolean {
  for (let at: Node["parent"] | null = node.parent; at; at = at.parent)
    if (at.type === "CallExpression" && isExpectChain(at.callee)) return true;
  return false;
}

function inClassListContains(node: Node): boolean {
  const call = node.parent;
  if (call?.type !== "CallExpression" || call.arguments[0] !== node)
    return false;
  const { callee } = call;
  return (
    callee.type === "MemberExpression" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "contains" &&
    callee.object.type === "MemberExpression" &&
    callee.object.property.type === "Identifier" &&
    callee.object.property.name === "classList"
  );
}

export const noClassAssertion: Rule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Assert behavior in tests, not zt: utility classes.",
    },
    messages: {
      ztClass:
        "Assert what the element does or says (text, role, state, data attribute), not its zt: classes; the running app proves the drawing (policies/ui-testing.md).",
    },
    schema: [],
  },
  create(context) {
    const check = (node: Node, text: string) => {
      if (
        classQuery.test(text) ||
        (ztClass.test(text) && (inClassListContains(node) || inAssertion(node)))
      )
        context.report({ node, messageId: "ztClass" });
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
        else if ("regex" in node && node.regex) check(node, node.regex.pattern);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

type AnyNode = NonNullable<CallNode["parent"]>;

function isArrayFrom(callee: CallNode["callee"]): boolean {
  return (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Array" &&
    staticName(callee) === "from"
  );
}

function isClassAttribute(node: CallNode): boolean {
  const [name] = node.arguments;
  return (
    node.callee.type === "MemberExpression" &&
    staticName(node.callee) === "getAttribute" &&
    name?.type === "Literal" &&
    name.value === "class"
  );
}

const selectorMethods = new Set([
  "querySelector",
  "querySelectorAll",
  "closest",
  "matches",
]);

function selectorText(node: AnyNode | undefined): string {
  if (node?.type === "Literal")
    return typeof node.value === "string" ? node.value : "x";
  if (node?.type === "TemplateLiteral")
    return node.quasis
      .map((part) => part.value.cooked ?? part.value.raw)
      .join("x");
  if (node?.type === "BinaryExpression" && node.operator === "+")
    return selectorText(node.left) + selectorText(node.right);
  return "x";
}

function isClassSelector(text: string): boolean {
  if (/\[\s*class\s*[\]~*^$|=]/.test(text)) return true;
  const bare = text.replaceAll(/"[^"]*"|'[^']*'|\[[^\]]*\]/g, "");
  return /\.[\w\\-]/.test(bare);
}

function isClassQuery(node: CallNode): boolean {
  return (
    node.callee.type === "MemberExpression" &&
    selectorMethods.has(staticName(node.callee) ?? "") &&
    isClassSelector(selectorText(node.arguments[0]))
  );
}

export const noMarkupAssertion: Rule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Assert behavior in unit tests, not classes or markup.",
    },
    messages: {
      markup:
        "Assert what the element does or says (text, role, state, data attribute), not its classes; markup belongs in an *.e2e.ts test (policies/testing-strategy.md).",
    },
    schema: [],
  },
  create(context) {
    const asserted = (node: AnyNode, seen = new Set<AnyNode>()): boolean => {
      let direct = true;
      for (let from = node, at = node.parent; at; from = at, at = at.parent) {
        if (at.type === "CallExpression") {
          if (isExpectChain(at.callee)) return true;
          if (
            direct &&
            at.arguments.includes(from as never) &&
            !isArrayFrom(at.callee)
          )
            return false;
        } else if (at.type === "VariableDeclarator" && at.init === from) {
          if (seen.has(at)) return false;
          seen.add(at);
          return context.sourceCode
            .getDeclaredVariables(at)
            .some((variable) =>
              variable.references.some(
                (reference) =>
                  !reference.init && asserted(reference.identifier, seen),
              ),
            );
        } else if (
          at.type === "ArrowFunctionExpression" ||
          at.type === "FunctionExpression"
        )
          direct = false;
        else if (
          direct &&
          at.type.endsWith("Statement") &&
          at.type !== "ReturnStatement" &&
          at.type !== "BlockStatement"
        )
          return false;
      }
      return false;
    };
    return {
      CallExpression(node) {
        if ((isClassAttribute(node) || isClassQuery(node)) && asserted(node))
          context.report({ node, messageId: "markup" });
      },
      MemberExpression(node) {
        const name = staticName(node);
        if ((name === "className" || name === "classList") && asserted(node))
          context.report({ node, messageId: "markup" });
      },
    };
  },
};

function pathFragments(
  node: NonNullable<CallNode["parent"]> | undefined,
): string[] {
  if (!node) return [];
  switch (node.type) {
    case "Literal":
      return typeof node.value === "string" ? [node.value] : [];
    case "TemplateLiteral":
      return [
        ...node.quasis.map((part) => part.value.cooked ?? part.value.raw),
        ...node.expressions.flatMap(pathFragments),
      ];
    case "CallExpression":
    case "NewExpression":
      return node.arguments.flatMap(pathFragments);
    case "BinaryExpression":
      return [...pathFragments(node.left), ...pathFragments(node.right)];
    case "ConditionalExpression":
      return [
        ...pathFragments(node.consequent),
        ...pathFragments(node.alternate),
      ];
    case "ArrayExpression":
      return node.elements.flatMap((element) =>
        pathFragments(element ?? undefined),
      );
    default:
      return [];
  }
}

const sourceExtensions = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "mjs",
  "cjs",
  "yml",
  "yaml",
  "md",
  "mdx",
  "css",
]);
const fixtureDirectories = new Set([
  "fixtures",
  "__fixtures__",
  "test-fixtures",
  "__snapshots__",
]);

function isSourceFile(path: string): boolean {
  const name = path.split("/").at(-1) ?? "";
  return (
    [...sourceExtensions].some((extension) => name.endsWith(`.${extension}`)) ||
    name === "package.json" ||
    name === "turbo.json" ||
    (name.startsWith("tsconfig") && name.endsWith(".json"))
  );
}

export const noSourceText: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Test behavior instead of reading source files as text.",
    },
    schema: [],
    messages: {
      sourceText:
        "Test the behavior a file produces, or enforce its static rules with lint or types; use fixtures for test data (policies/testing-strategy.md).",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        const name =
          callee.type === "Identifier"
            ? callee.name
            : callee.type === "MemberExpression"
              ? staticName(callee)
              : undefined;
        if (name !== "readFile" && name !== "readFileSync") return;
        const fragments = pathFragments(node.arguments[0]).map((part) =>
          part.replaceAll("\\", "/"),
        );
        if (
          fragments.some((part) =>
            part
              .split("/")
              .some((directory) => fixtureDirectories.has(directory)),
          )
        )
          return;
        if (fragments.some((part) => isSourceFile(part)))
          context.report({ node, messageId: "sourceText" });
      },
      ImportDeclaration(node) {
        if (node.source.value.endsWith("?raw"))
          context.report({ node, messageId: "sourceText" });
      },
    };
  },
};

function staticName(
  node: Extract<CallNode["callee"], { type: "MemberExpression" }>,
): string | undefined {
  if (!node.computed && node.property.type === "Identifier")
    return node.property.name;
  if (
    node.computed &&
    node.property.type === "Literal" &&
    typeof node.property.value === "string"
  )
    return node.property.value;
  return undefined;
}

export const noInternalMock: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Run repository modules for real; mock only outer boundaries.",
    },
    schema: [],
    messages: {
      internalMock:
        "Run repository modules for real; mock process, network and OS boundaries and assert outputs and effects (policies/testing-strategy.md).",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        if (
          callee.type !== "MemberExpression" ||
          callee.object.type !== "Identifier" ||
          callee.object.name !== "vi"
        )
          return;
        const name = staticName(callee);
        if (name !== "mock" && name !== "doMock") return;
        const argument = node.arguments[0];
        const specifier =
          argument?.type === "ImportExpression" ? argument.source : argument;
        const parts =
          specifier?.type === "Literal" && typeof specifier.value === "string"
            ? [specifier.value]
            : specifier?.type === "TemplateLiteral" &&
                specifier.expressions.length === 0
              ? pathFragments(specifier)
              : [];
        if (
          parts.some(
            (part) =>
              part.startsWith(".") ||
              part.startsWith("#") ||
              part.startsWith("@/") ||
              part.startsWith("@zotlit/"),
          )
        )
          context.report({ node, messageId: "internalMock" });
      },
    };
  },
};

export const noEvalCapture: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep serialized page callbacks self-contained (policies/testing-strategy.md).",
    },
    schema: [],
    messages: {
      capture:
        "Pass '{{name}}' through args; a serialized page callback cannot capture host bindings.",
      callback:
        "Use an arrow or function expression for a serialized page callback.",
      thisValue:
        "Use the callback context instead of this in serialized page code.",
    },
  },
  create(context) {
    const callbacks = new Set<AnyNode>();
    const thisNodes: AnyNode[] = [];
    function resolve(node: AnyNode, seen = new Set<AnyNode>()): AnyNode {
      if (node.type !== "Identifier" || seen.has(node)) return node;
      seen.add(node);
      for (
        let scope = context.sourceCode.getScope(node);
        scope;
        scope = scope.upper!
      ) {
        const variable = scope.set.get(node.name);
        if (!variable) continue;
        const declaration = variable.defs[0]?.node;
        if (declaration?.type === "VariableDeclarator" && declaration.init)
          return resolve(declaration.init, seen);
        return declaration ?? node;
      }
      return node;
    }
    return {
      CallExpression(node) {
        const name =
          node.callee.type === "Identifier"
            ? node.callee.name
            : node.callee.type === "MemberExpression"
              ? staticName(node.callee)
              : undefined;
        if (
          name !== "obRun" &&
          name !== "obRunUntil" &&
          name !== "readQueryViewUntil"
        )
          return;
        const argument = node.arguments[1];
        if (!argument) return;
        const callback = resolve(argument);
        if (
          callback.type !== "ArrowFunctionExpression" &&
          callback.type !== "FunctionExpression"
        ) {
          context.report({ node: argument, messageId: "callback" });
          return;
        }
        callbacks.add(callback);
      },
      ThisExpression(node) {
        thisNodes.push(node);
      },
      "Program:exit"() {
        for (const callback of callbacks) {
          const scope = context.sourceCode.getScope(callback);
          for (const reference of scope.through) {
            if ("isValueReference" in reference && !reference.isValueReference)
              continue;
            if (!reference.resolved || reference.resolved.defs.length === 0)
              continue;
            if (
              reference.resolved.defs.some(
                (definition) => definition.node === callback,
              )
            )
              continue;
            context.report({
              node: reference.identifier,
              messageId: "capture",
              data: { name: reference.identifier.name },
            });
          }
          for (const node of thisNodes) {
            for (let at: AnyNode | null = node; at; at = at.parent) {
              if (at === callback) {
                context.report({ node, messageId: "thisValue" });
                break;
              }
              if (
                at.type === "FunctionExpression" ||
                at.type === "FunctionDeclaration"
              )
                break;
            }
          }
        }
      },
    };
  },
};

const pollCalls = new Set(["obRunUntil", "readQueryViewUntil"]);

function calledName(node: CallNode): string | undefined {
  const { callee } = node;
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression") return staticName(callee);
  return undefined;
}

function returnsLiteral(node: AnyNode | undefined, value: boolean): boolean {
  return (
    node?.type === "ArrowFunctionExpression" &&
    node.params.length === 0 &&
    node.body.type === "Literal" &&
    node.body.value === value
  );
}

export const noTypedArgName: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Name page callback args after their role.",
    },
    schema: [],
    messages: {
      placeholder:
        "Name '{{name}}' after its role, such as 'attachmentPath', 'itemKey' or 'expectedCount', in both the callback and its args.",
    },
  },
  create(context) {
    return {
      Identifier(node) {
        if (/^__typedArg\d+$/.test(node.name))
          context.report({
            node,
            messageId: "placeholder",
            data: { name: node.name },
          });
      },
    };
  },
};

export const noPollAdapter: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Await a poll directly instead of adapting it to a boolean.",
    },
    schema: [],
    messages: {
      adapter:
        "Write 'await obRunUntil(…)': a timeout rejects with 'what' and the last value. Keep '.then(() => true, () => false)' only where the caller acts on a timeout.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        if (
          callee.type === "MemberExpression" &&
          staticName(callee) === "then" &&
          node.arguments.length === 2 &&
          returnsLiteral(node.arguments[0], true) &&
          returnsLiteral(node.arguments[1], false)
        )
          context.report({ node, messageId: "adapter" });
      },
    };
  },
};

export const noPollWrapper: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Call a poll directly instead of through an inline wrapper.",
    },
    schema: [],
    messages: {
      wrapper:
        "Call '{{name}}' directly with its 'ready' and 'tries' options; an inline wrapper hides the poll.",
    },
  },
  create(context) {
    function polled(node: AnyNode | undefined): CallNode | undefined {
      let at = node;
      while (at) {
        if (at.type === "AwaitExpression") at = at.argument as AnyNode;
        else if (at.type === "CallExpression") {
          if (pollCalls.has(calledName(at) ?? "")) return at;
          if (at.callee.type !== "MemberExpression") return undefined;
          at = at.callee.object as AnyNode;
        } else return undefined;
      }
      return undefined;
    }
    return {
      CallExpression(node) {
        const { callee } = node;
        if (
          callee.type !== "ArrowFunctionExpression" &&
          callee.type !== "FunctionExpression"
        )
          return;
        const { body } = callee;
        const poll = polled(
          body && body.type !== "BlockStatement" ? body : undefined,
        );
        if (poll)
          context.report({
            node,
            messageId: "wrapper",
            data: { name: calledName(poll) },
          });
      },
    };
  },
};

export const noGeneratedPollLabel: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Describe the awaited condition in a poll's 'what'.",
    },
    schema: [],
    messages: {
      label:
        "Describe the awaited condition, such as 'the Annotation View to list the pinned item', instead of a source location.",
    },
  },
  create(context) {
    return {
      Property(node) {
        const { key, value } = node;
        if (
          node.computed ||
          key.type !== "Identifier" ||
          key.name !== "what" ||
          value.type !== "Literal" ||
          typeof value.value !== "string" ||
          !/\.[cm]?[jt]sx?:\d+$/.test(value.value)
        )
          return;
        context.report({ node: value, messageId: "label" });
      },
    };
  },
};

function stringifies(node: AnyNode | undefined): boolean {
  if (!node || typeof node !== "object") return false;
  if (
    node.type === "Literal" &&
    (node.value === "true" || node.value === "false") &&
    (node.parent?.type === "ReturnStatement" ||
      node.parent?.type === "ArrowFunctionExpression" ||
      node.parent?.type === "ConditionalExpression")
  )
    return true;
  if (
    node.type === "Identifier" &&
    node.name === "String" &&
    node.parent?.type === "CallExpression"
  )
    return true;
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const child = (node as unknown as Record<string, unknown>)[key];
    for (const part of Array.isArray(child) ? child : [child])
      if (part && typeof part === "object" && "type" in part)
        if (stringifies(part as AnyNode)) return true;
  }
  return false;
}

export const noStringTransport: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep poll values typed instead of converting them to strings.",
    },
    schema: [],
    messages: {
      nested:
        "Drop the outer 'String(…)': converting a value that is already a string changes nothing.",
      boolean:
        "Return the boolean and compare with '=== true' (the default 'ready'), not the string \"{{text}}\".",
    },
  },
  create(context) {
    const isString = (node: AnyNode | undefined): node is CallNode =>
      node?.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      node.callee.name === "String" &&
      node.arguments.length === 1;
    return {
      CallExpression(node) {
        if (isString(node) && isString(node.arguments[0]))
          context.report({ node, messageId: "nested" });
        if (!pollCalls.has(calledName(node) ?? "")) return;
        const options = node.arguments[3];
        if (options?.type !== "ObjectExpression") return;
        if (!stringifies(node.arguments[1])) return;
        for (const option of options.properties) {
          if (
            option.type !== "Property" ||
            option.key.type !== "Identifier" ||
            option.key.name !== "ready"
          )
            continue;
          const seek = (at: AnyNode): void => {
            if (
              at.type === "Literal" &&
              (at.value === "true" || at.value === "false") &&
              at.parent?.type === "BinaryExpression"
            )
              context.report({
                node: at,
                messageId: "boolean",
                data: { text: at.value },
              });
            for (const key of Object.keys(at)) {
              if (key === "parent") continue;
              const child = (at as unknown as Record<string, unknown>)[key];
              for (const part of Array.isArray(child) ? child : [child])
                if (part && typeof part === "object" && "type" in part)
                  seek(part as AnyNode);
            }
          };
          seek(option.value);
        }
      },
    };
  },
};

const CONSOLE_OUTPUT = new Set([
  "log",
  "info",
  "debug",
  "warn",
  "error",
  "table",
  "dir",
  "trace",
]);

function isStdWrite(callee: CallNode["callee"]): boolean {
  return (
    callee.type === "MemberExpression" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "write" &&
    callee.object.type === "MemberExpression" &&
    callee.object.object.type === "Identifier" &&
    callee.object.object.name === "process" &&
    callee.object.property.type === "Identifier" &&
    (callee.object.property.name === "stdout" ||
      callee.object.property.name === "stderr")
  );
}

function isConsoleOutput(callee: CallNode["callee"]): boolean {
  return (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.object.name === "console" &&
    callee.property.type === "Identifier" &&
    CONSOLE_OUTPUT.has(callee.property.name)
  );
}

function inFailureHook(node: CallNode): boolean {
  for (let at: CallNode["parent"] | null = node.parent; at; at = at.parent)
    if (
      at.type === "CallExpression" &&
      at.callee.type === "Identifier" &&
      at.callee.name === "onTestFailed"
    )
      return true;
  return false;
}

export const noTestOutput: Rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Rejects a process.stdout or process.stderr write and a console call in a test file outside onTestFailed.",
    },
    messages: {
      testOutput:
        "Print diagnostic output inside onTestFailed(() => ...), so a passing test prints nothing and the test log stays short.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          (isStdWrite(node.callee) || isConsoleOutput(node.callee)) &&
          !inFailureHook(node)
        )
          context.report({ node, messageId: "testOutput" });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-tests" },
  rules: {
    "no-eval-capture": noEvalCapture,
    "no-class-assertion": noClassAssertion,
    "no-markup-assertion": noMarkupAssertion,
    "no-source-text": noSourceText,
    "no-internal-mock": noInternalMock,
    "no-typed-arg-name": noTypedArgName,
    "no-poll-adapter": noPollAdapter,
    "no-poll-wrapper": noPollWrapper,
    "no-generated-poll-label": noGeneratedPollLabel,
    "no-string-transport": noStringTransport,
    "no-test-output": noTestOutput,
  },
};
