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
