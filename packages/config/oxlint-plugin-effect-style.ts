import type { AstNode, Rule } from "./oxlint-ast.ts";

const CALLBACK_LAST: Readonly<Record<string, ReadonlySet<string>>> = {
  Effect: new Set([
    "acquireRelease",
    "acquireUseRelease",
    "addFinalizer",
    "bind",
    "callback",
    "catch",
    "catchCause",
    "catchCauseFilter",
    "catchCauseIf",
    "catchDefect",
    "catchFilter",
    "catchIf",
    "catchReason",
    "catchTag",
    "clockWith",
    "contextWith",
    "filter",
    "filterMap",
    "filterMapEffect",
    "filterMapOrElse",
    "filterMapOrFail",
    "filterOrElse",
    "filterOrFail",
    "findFirst",
    "flatMap",
    "forEach",
    "interruptibleMask",
    "let",
    "map",
    "mapError",
    "onError",
    "onErrorFilter",
    "onErrorIf",
    "onExit",
    "onExitFilter",
    "onExitIf",
    "onInterrupt",
    "partition",
    "promise",
    "reduce",
    "repeatOrElse",
    "retryOrElse",
    "scopedWith",
    "tapCause",
    "tapCauseFilter",
    "tapCauseIf",
    "tapDefect",
    "tapError",
    "tapErrorTag",
    "tryPromise",
    "uninterruptibleMask",
    "updateContext",
    "updateService",
    "withFiber",
    "zipWith",
  ]),
  Stream: new Set([
    "bind",
    "bindEffect",
    "callback",
    "catch",
    "catchCause",
    "catchCauseFilter",
    "catchCauseIf",
    "catchDefect",
    "catchFilter",
    "catchIf",
    "catchReason",
    "catchTag",
    "dropUntil",
    "dropUntilEffect",
    "dropWhile",
    "dropWhileEffect",
    "dropWhileFilter",
    "filter",
    "filterEffect",
    "filterMap",
    "filterMapEffect",
    "flatMap",
    "groupAdjacentBy",
    "groupBy",
    "groupByKey",
    "iterate",
    "let",
    "map",
    "mapAccum",
    "mapAccumArray",
    "mapAccumArrayEffect",
    "mapAccumEffect",
    "mapArray",
    "mapArrayEffect",
    "mapEffect",
    "mapError",
    "onError",
    "onExit",
    "onFirst",
    "paginate",
    "partition",
    "partitionEffect",
    "runFold",
    "runFoldEffect",
    "runForEach",
    "runForEachArray",
    "runForEachWhile",
    "scan",
    "scanEffect",
    "split",
    "switchMap",
    "takeUntil",
    "takeUntilEffect",
    "takeWhile",
    "takeWhileEffect",
    "takeWhileFilter",
    "tap",
    "tapCause",
    "tapDefect",
    "tapError",
    "tapErrorTag",
    "unfold",
    "updateContext",
    "updateService",
    "zipLatestWith",
    "zipWith",
    "zipWithArray",
  ]),
  Option: new Set([
    "bind",
    "exists",
    "filter",
    "filterMap",
    "flatMap",
    "flatMapNullishOr",
    "let",
    "map",
    "partitionMap",
    "tap",
    "zipWith",
  ]),
  Result: new Set([
    "bind",
    "filterOrFail",
    "flatMap",
    "fromNullishOr",
    "getOrElse",
    "getOrThrowWith",
    "let",
    "map",
    "mapError",
    "orElse",
    "tap",
  ]),
  Exit: new Set(["map", "mapError"]),
  Cause: new Set(["map"]),
  Layer: new Set([
    "catch",
    "catchCause",
    "catchTag",
    "flatMap",
    "fromBuild",
    "fromBuildMemo",
    "tap",
    "tapCause",
    "tapError",
    "updateService",
  ]),
  Schedule: new Set(["addDelay", "map", "modifyDelay", "tap", "while"]),
  Ref: new Set([
    "getAndUpdate",
    "getAndUpdateSome",
    "modify",
    "modifySome",
    "update",
    "updateAndGet",
    "updateSome",
    "updateSomeAndGet",
  ]),
  SubscriptionRef: new Set([
    "getAndUpdate",
    "getAndUpdateEffect",
    "getAndUpdateSome",
    "getAndUpdateSomeEffect",
    "modify",
    "modifyEffect",
    "modifySome",
    "modifySomeEffect",
    "update",
    "updateAndGet",
    "updateAndGetEffect",
    "updateEffect",
    "updateSome",
    "updateSomeAndGet",
    "updateSomeAndGetEffect",
    "updateSomeEffect",
  ]),
  Array: new Set([
    "bind",
    "cartesianWith",
    "chop",
    "countBy",
    "dropWhile",
    "every",
    "extend",
    "filter",
    "filterMap",
    "findFirst",
    "findFirstIndex",
    "findFirstWithIndex",
    "findLast",
    "findLastIndex",
    "flatMap",
    "flatMapNullishOr",
    "forEach",
    "groupBy",
    "let",
    "makeBy",
    "map",
    "mapAccum",
    "modify",
    "partition",
    "reduce",
    "reduceRight",
    "scan",
    "scanRight",
    "some",
    "span",
    "splitWhere",
    "takeWhile",
    "unfold",
    "zipWith",
  ]),
  SchemaGetter: new Set([
    "map",
    "transform",
    "transformEffect",
    "transformOptional",
    "transformOptionalEffect",
  ]),
};

const DATA_FIRST_CALLBACK: Readonly<Record<string, number>> = {
  "Effect.filter": 1,
  "Effect.filterMapEffect": 1,
  "Effect.forEach": 1,
  "Effect.partition": 1,
  "Effect.zipWith": 2,
  "Stream.bind": 2,
  "Stream.bindEffect": 2,
  "Stream.flatMap": 1,
  "Stream.groupBy": 1,
  "Stream.groupByKey": 1,
  "Stream.mapAccum": 2,
  "Stream.mapAccumArray": 2,
  "Stream.mapAccumArrayEffect": 2,
  "Stream.mapAccumEffect": 2,
  "Stream.mapEffect": 1,
  "Stream.partition": 1,
  "Stream.partitionEffect": 1,
  "Stream.switchMap": 1,
  "Stream.takeUntil": 1,
  "Stream.takeUntilEffect": 1,
  "Stream.tap": 1,
};

const FUNCTION_MODULE = "Function";

interface ImportSpecifier {
  readonly type: string;
  readonly importKind?: string;
  readonly local: { readonly name: string };
  readonly imported?: {
    readonly name?: string;
    readonly value?: string;
  };
}

interface EffectNames {
  readonly modules: Map<string, string>;
  readonly flow: Set<string>;
}

function collectNames(
  source: string,
  specifiers: readonly ImportSpecifier[],
  names: EffectNames,
): void {
  const submodule = source.startsWith("effect/")
    ? source.slice("effect/".length)
    : undefined;
  for (const specifier of specifiers) {
    if (specifier.importKind === "type") continue;
    const imported = specifier.imported?.name ?? specifier.imported?.value;
    const local = specifier.local.name;
    if (specifier.type === "ImportNamespaceSpecifier" && submodule)
      names.modules.set(local, submodule);
    else if (specifier.type !== "ImportSpecifier") continue;
    else if (
      imported === "flow" &&
      (source === "effect" || submodule === FUNCTION_MODULE)
    )
      names.flow.add(local);
    else if (source === "effect" && typeof imported === "string")
      names.modules.set(local, imported);
  }
}

function combinator(
  callee: AstNode | undefined,
  names: EffectNames,
): string | undefined {
  if (
    callee?.type !== "MemberExpression" ||
    callee.computed ||
    callee.object?.type !== "Identifier" ||
    callee.property?.type !== "Identifier"
  )
    return undefined;
  const module = names.modules.get(callee.object.name as string);
  return module && `${module}.${callee.property.name as string}`;
}

type RuleContext = Parameters<NonNullable<Rule["create"]>>[0];

function argumentShape(node: AstNode | undefined, context: RuleContext) {
  const expressionShape = (expression: AstNode | undefined) => {
    switch (expression?.type) {
      case "ArrowFunctionExpression":
      case "FunctionExpression":
        return "callback";
      case "ObjectExpression":
        return "object";
      case "ArrayExpression":
        return "array";
    }
  };
  const direct = expressionShape(node);
  if (direct) return direct;
  if (node?.type !== "Identifier" || typeof node.name !== "string")
    return undefined;

  for (
    let scope = context.sourceCode.getScope(node as never);
    scope;
    scope = scope.upper!
  ) {
    const variable = scope.set.get(node.name);
    if (!variable) continue;
    for (const { name, node: declaration, type } of variable.defs) {
      if (type === "FunctionName") return "callback";
      const annotation =
        "typeAnnotation" in name ? name.typeAnnotation?.typeAnnotation : null;
      if (annotation?.type === "TSFunctionType") return "callback";
      if (annotation?.type === "TSTypeLiteral")
        return annotation.members.some(
          (member) => member.type === "TSCallSignatureDeclaration",
        )
          ? "callback"
          : "object";
      if (
        annotation?.type === "TSArrayType" ||
        annotation?.type === "TSTupleType"
      )
        return "array";
      if (
        declaration.type !== "VariableDeclarator" ||
        declaration.id.type !== "Identifier"
      )
        continue;
      let value = declaration.init;
      while (
        value?.type === "TSAsExpression" ||
        value?.type === "TSSatisfiesExpression"
      )
        value = value.expression;
      const shape = expressionShape(value ?? undefined);
      if (shape) return shape;
    }
    break;
  }
  return undefined;
}

function callbackArgument(
  name: string,
  call: AstNode,
  context: RuleContext,
): AstNode | undefined {
  const args = call.arguments ?? [];
  if (name === "Effect.acquireRelease") return args[1];
  if (name === "Stream.callback") return args[0];
  const index = DATA_FIRST_CALLBACK[name];
  if (index === undefined) return args.at(-1);
  if (args.length > index + 1) return args[index];
  if (args.length <= index) return args[index - 1];

  const last = args[index];
  const preceding = args[index - 1];
  const lastShape = argumentShape(last, context);
  if (lastShape === "object") return preceding;
  if (lastShape === "callback") return last;

  const parent = call.parent;
  if (
    parent?.type === "CallExpression" &&
    (parent.callee === call ||
      parent.callee?.property?.name === "pipe" ||
      (parent.callee?.name === "pipe" && parent.arguments?.[0] !== call))
  )
    return preceding;

  const firstShape = argumentShape(args[0], context);
  if (firstShape === "array") return last;
  if (firstShape === "callback") return preceding;
  if (
    index > 1 &&
    !name.startsWith("Stream.mapAccum") &&
    argumentShape(preceding, context) === "callback"
  )
    return preceding;
  return undefined;
}

function isReference(node: AstNode | undefined): boolean {
  return node?.type === "Identifier" || node?.type === "MemberExpression";
}

export const noTacit: Rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Pass an explicit lambda, not a function by name, to an Effect combinator.",
    },
    messages: {
      tacit:
        "Pass an explicit lambda, `(x) => {{name}}(x)`, to {{combinator}}: a function passed by name gets every argument the combinator passes, and loses its generics and its stack frame.",
      flow: "Write `(x) => pipe(x, f, g)` or call the steps in a lambda instead of `flow`: a tacit pipeline loses its generics and its stack frames.",
    },
    schema: [],
  },
  create(context) {
    const names: EffectNames = { modules: new Map(), flow: new Set() };
    return {
      ImportDeclaration(node) {
        if (node.importKind === "type") return;
        collectNames(node.source.value, node.specifiers, names);
      },
      CallExpression(node) {
        const callee = node.callee as AstNode;
        if (
          (callee.type === "Identifier" &&
            names.flow.has(callee.name as string)) ||
          combinator(callee, names) === `${FUNCTION_MODULE}.flow`
        ) {
          context.report({ node, messageId: "flow" });
          return;
        }
        const name = combinator(callee, names);
        if (!name) return;
        const [module, member] = name.split(".") as [string, string];
        if (!CALLBACK_LAST[module]?.has(member)) return;
        const argument = callbackArgument(name, node, context);
        if (!argument || !isReference(argument)) return;
        context.report({
          node: argument as never,
          messageId: "tacit",
          data: {
            name: context.sourceCode.getText(argument as never),
            combinator: name,
          },
        });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-effect-style" },
  rules: { "no-tacit": noTacit },
};
