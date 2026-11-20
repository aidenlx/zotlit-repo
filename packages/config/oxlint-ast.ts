// What the ZotLit oxlint plugins share: the rule type and the AST they read.
import type { RuleTester } from "oxlint/plugins-dev";

export type Rule = Parameters<RuleTester["run"]>[1];

/** The fields these rules read; every ESTree node fits it. */
export interface AstNode {
  readonly type: string;
  readonly parent?: AstNode | null;
  readonly name?: unknown;
  readonly value?: unknown;
  readonly computed?: boolean;
  readonly generator?: boolean;
  readonly kind?: string;
  readonly object?: AstNode;
  readonly property?: AstNode;
  readonly callee?: AstNode;
  readonly arguments?: readonly AstNode[];
  readonly superClass?: AstNode | null;
}

/** `<object>.<name>`, where `object` names one of `objects` and `name` matches. */
export function isMemberOf(
  node: AstNode | undefined,
  objects: ReadonlySet<string>,
  name: (property: string) => boolean,
): boolean {
  return (
    node?.type === "MemberExpression" &&
    !node.computed &&
    node.object?.type === "Identifier" &&
    objects.has(node.object.name as string) &&
    node.property?.type === "Identifier" &&
    typeof node.property.name === "string" &&
    name(node.property.name)
  );
}

export interface ModuleStatement extends AstNode {
  readonly importKind?: string;
  readonly source?: {
    readonly value?: unknown;
  };
  readonly specifiers?: readonly (AstNode & {
    readonly imported?: AstNode;
    readonly importKind?: string;
  })[];
}

export interface ModuleProgram extends AstNode {
  readonly body?: readonly ModuleStatement[];
}

/** An import, re-export or `export *`: a statement with a module source. */
export function hasSource(node: ModuleStatement): boolean {
  return (
    node.type === "ImportDeclaration" ||
    node.type === "ExportNamedDeclaration" ||
    node.type === "ExportAllDeclaration"
  );
}

/**
 * The plugin packages' Effect helpers (`effect-*.ts`), by package name from
 * outside the package and by `#` subpath import from inside it.
 */
const EFFECT_HELPER_MODULE =
  /^(?:@zotlit\/(?:plugin-kernel|obsidian-kit|obsidian-desktop)\/|#)effect-/u;

function isEffectModule(source: string): boolean {
  return (
    source === "effect" ||
    source.startsWith("effect/") ||
    EFFECT_HELPER_MODULE.test(source)
  );
}

/**
 * A type-only import of the Effect bridge names the seam a legacy file holds,
 * not Effect code in the file (policies/services.md → Bridge).
 */
function isBridgeType(statement: ModuleStatement, source: string): boolean {
  return (
    statement.type === "ImportDeclaration" &&
    statement.importKind === "type" &&
    (source === "@zotlit/plugin-kernel/effect-bridge.ts" ||
      source === "#effect-bridge.ts")
  );
}

/**
 * Whether a module imports Effect: any import or re-export from `effect`,
 * one of its submodules or an `effect-*` module of the plugin packages, but not a type-only import of the
 * bridge.
 */
export function importsEffect(statements: readonly ModuleStatement[]): boolean {
  return statements.some((statement) => {
    if (!hasSource(statement)) return false;
    const source = statement.source?.value;
    return (
      typeof source === "string" &&
      isEffectModule(source) &&
      !isBridgeType(statement, source)
    );
  });
}

const LOGGING_SOURCES = new Set([
  "effect",
  "@zotlit/plugin-kernel/effect-log.ts",
  "#effect-log.ts",
]);

const LOGGING_NAMES = new Set([
  "Effect",
  "logServices",
  "withLogCategory",
  "logLevelEnabled",
]);

const LOGGING_EFFECT_MEMBER =
  /^(?:log(?:Trace|Debug|Info|Warning|Error|Fatal|WithLevel)?|annotateLogs|withLogSpan|runSyncWith)$/u;

const EFFECT_MEMBER = /\bEffect\.(\w+)/gu;

function importsOnlyLogging(statements: readonly ModuleStatement[]): boolean {
  return statements.every((statement) => {
    if (!hasSource(statement)) return true;
    const source = statement.source?.value;
    if (
      typeof source !== "string" ||
      !isEffectModule(source) ||
      isBridgeType(statement, source)
    )
      return true;
    return (
      statement.type === "ImportDeclaration" &&
      statement.importKind !== "type" &&
      LOGGING_SOURCES.has(source) &&
      (statement.specifiers ?? []).every(
        (specifier) =>
          specifier.type === "ImportSpecifier" &&
          LOGGING_NAMES.has(specifier.imported?.name as string),
      )
    );
  });
}

/**
 * Whether a module is Effect code: it imports Effect ({@link importsEffect})
 * for more than logging. Plain code logs through `Effect.log*`, its fields
 * through `Effect.annotateLogs` and its category through `withLogCategory`,
 * run with `Effect.runSyncWith(logServices)`; those uses alone keep it plain
 * (policies/logging.md).
 */
export function isEffectCode(
  statements: readonly ModuleStatement[],
  sourceText: string,
): boolean {
  if (!importsEffect(statements)) return false;
  if (!importsOnlyLogging(statements)) return true;
  const members = [...sourceText.matchAll(EFFECT_MEMBER)].map(
    ([, member]) => member!,
  );
  return (
    members.length === 0 ||
    members.some((member) => !LOGGING_EFFECT_MEMBER.test(member))
  );
}
