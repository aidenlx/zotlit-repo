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

const OPTIONS_AFTER = new Set([
  "Effect.acquireRelease",
  "Effect.filter",
  "Effect.filterMapEffect",
  "Effect.forEach",
  "Effect.partition",
  "Effect.zipWith",
  "Stream.bind",
  "Stream.bindEffect",
  "Stream.callback",
  "Stream.flatMap",
  "Stream.groupBy",
  "Stream.groupByKey",
  "Stream.mapAccum",
  "Stream.mapAccumArray",
  "Stream.mapAccumArrayEffect",
  "Stream.mapAccumEffect",
  "Stream.mapEffect",
  "Stream.partition",
  "Stream.partitionEffect",
  "Stream.switchMap",
  "Stream.takeUntil",
  "Stream.takeUntilEffect",
  "Stream.tap",
]);

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

function callbackArgument(
  name: string,
  args: readonly AstNode[],
): AstNode | undefined {
  const last = args.at(-1);
  if (last?.type === "ObjectExpression" && OPTIONS_AFTER.has(name))
    return args.at(-2);
  return last;
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
        const argument = callbackArgument(name, node.arguments);
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
