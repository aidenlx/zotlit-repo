import { dirname, resolve, sep } from "node:path";

import { isEffectCode, isMemberOf } from "./oxlint-ast.ts";
import type { AstNode, ModuleProgram, Rule } from "./oxlint-ast.ts";

const EFFECT_GENERATOR_CALLEES = new Set(["gen", "fn", "fnUntraced"]);

const EFFECT = new Set(["Effect"]);
const DATE = new Set(["Date"]);
const PERFORMANCE = new Set(["performance"]);

function isEffectMember(
  node: AstNode | undefined,
  names: ReadonlySet<string>,
): boolean {
  return isMemberOf(node, EFFECT, (name) => names.has(name));
}

function isEffectGenerator(node: AstNode): boolean {
  if (node.type !== "FunctionExpression" || !node.generator) return false;
  const call = node.parent;
  if (call?.type !== "CallExpression" || !call.arguments?.includes(node))
    return false;
  const { callee } = call;
  return (
    isEffectMember(callee, EFFECT_GENERATOR_CALLEES) ||
    (callee?.type === "CallExpression" &&
      isEffectMember(callee.callee, EFFECT_GENERATOR_CALLEES))
  );
}

function isDisposeKey(node: AstNode | undefined): boolean {
  const key = node?.computed ? node.property : undefined;
  return (
    node?.type === "MemberExpression" &&
    key?.type === "MemberExpression" &&
    key.object?.type === "Identifier" &&
    key.object.name === "Symbol" &&
    (key.property?.name === "dispose" || key.property?.name === "asyncDispose")
  );
}

export const effectNativeResources: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require Scope-managed resources in Effect generators.",
    },
    messages: {
      stack:
        "Acquire with Effect.acquireRelease or Effect.addFinalizer; the generator's Scope owns its resources.",
      using:
        "Acquire with Effect.acquireRelease, or Effect.acquireDisposable for a Disposable; the generator's Scope owns its resources.",
      dispose:
        "Release through the Scope: Effect.acquireRelease, Effect.addFinalizer, or Effect.acquireDisposable.",
    },
    schema: [],
  },
  create(context) {
    const functions: boolean[] = [];
    const inEffect = () => functions.at(-1) === true;
    const enter = (node: unknown) =>
      functions.push(isEffectGenerator(node as AstNode));
    const exit = () => functions.pop();
    return {
      FunctionDeclaration: enter,
      "FunctionDeclaration:exit": exit,
      FunctionExpression: enter,
      "FunctionExpression:exit": exit,
      ArrowFunctionExpression: enter,
      "ArrowFunctionExpression:exit": exit,
      VariableDeclaration(node) {
        if (
          inEffect() &&
          (node.kind === "using" || node.kind === "await using")
        )
          context.report({ node, messageId: "using" });
      },
      NewExpression(node) {
        if (
          inEffect() &&
          node.callee.type === "Identifier" &&
          (node.callee.name === "DisposableStack" ||
            node.callee.name === "AsyncDisposableStack")
        )
          context.report({ node, messageId: "stack" });
      },
      CallExpression(node) {
        if (inEffect() && isDisposeKey(node.callee))
          context.report({ node, messageId: "dispose" });
      },
    };
  },
};

export const noLegacyService: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require new services to be Effect services.",
    },
    messages: {
      legacy:
        "Build a new service as a Context.Service tag with a scoped Layer in pluginLayer (/obsidian-services → Effect services).",
    },
    schema: [],
  },
  create(context) {
    const check = ({ superClass }: { superClass?: AstNode | null }) => {
      if (superClass?.type === "Identifier" && superClass.name === "Service")
        context.report({ node: superClass as never, messageId: "legacy" });
    };
    return { ClassDeclaration: check, ClassExpression: check };
  },
};

const TAG_ID = /^zotlit\/[a-z0-9-]+\/[A-Z][A-Za-z0-9]*$/;

export const serviceTagId: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require Context.Service ids of the form zotlit/<module>/<Name>.",
    },
    messages: {
      id: 'Name the tag "zotlit/<module>/<Name>": the module it belongs to, then its class.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const inner = node.callee;
        if (
          inner.type !== "CallExpression" ||
          inner.callee.type !== "MemberExpression" ||
          inner.callee.object.type !== "Identifier" ||
          inner.callee.object.name !== "Context" ||
          inner.callee.property.type !== "Identifier" ||
          inner.callee.property.name !== "Service"
        )
          return;
        const [id] = node.arguments;
        if (
          id?.type !== "Literal" ||
          typeof id.value !== "string" ||
          !TAG_ID.test(id.value)
        )
          context.report({ node: id ?? node, messageId: "id" });
      },
    };
  },
};

export const cliCommandRegistration: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Register a zotlit:* command through registerCliCommand, not registerCliHandler.",
    },
    messages: {
      handler:
        "Register the command with host.registerCliCommand and an Effect handler (@zotlit/obsidian-kit/cli-command.ts).",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.property.type === "Identifier" &&
          callee.property.name === "registerCliHandler" &&
          callee.object.type !== "Super" &&
          callee.object.type !== "ThisExpression"
        )
          context.report({ node: callee.property, messageId: "handler" });
      },
    };
  },
};

interface WorkerNode extends AstNode {
  readonly expression?: WorkerNode;
  readonly typeAnnotation?: WorkerNode;
  readonly typeName?: WorkerNode;
}

function memberName(node: AstNode): unknown {
  return node.computed ? node.property?.value : node.property?.name;
}

function workerType(node: WorkerNode | undefined): boolean {
  if (!node) return false;
  if (node.type === "TSTypeAnnotation") return workerType(node.typeAnnotation);
  return (
    node.type === "TSTypeReference" &&
    ["Worker", "DedicatedWorkerGlobalScope", "WorkerGlobalScope"].includes(
      String(node.typeName?.name),
    )
  );
}

export const workerRpc: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Run workers on effect/rpc." },
    messages: {
      rpc: "Run the worker on effect/rpc; follow packages/zotero-reads/src/{contract/rpc,worker/serve,worker/worker-launch,client/worker-host,worker/in-process}.ts.",
    },
    schema: [],
  },
  create(context) {
    const isConstructor = (node: AstNode) =>
      (node.type === "Identifier" && node.name === "Worker") ||
      (node.type === "MemberExpression" && memberName(node) === "Worker");
    const isWorker = (
      node: WorkerNode | undefined,
      seen = new Set<AstNode>(),
    ): boolean => {
      if (!node || seen.has(node)) return false;
      seen.add(node);
      if (workerType(node.typeAnnotation)) return true;
      if (
        node.type === "TSAsExpression" ||
        node.type === "TSNonNullExpression" ||
        node.type === "ChainExpression"
      )
        return isWorker(node.expression, seen);
      if (node.type === "NewExpression")
        return !!node.callee && isConstructor(node.callee);
      if (node.type === "MemberExpression")
        return (
          String(memberName(node)).toLowerCase().endsWith("worker") ||
          memberName(node) === "self"
        );
      if (node.type !== "Identifier" || typeof node.name !== "string")
        return false;
      for (
        let scope = context.sourceCode.getScope(node as never);
        scope;
        scope = scope.upper!
      ) {
        const variable = scope.set.get(node.name);
        if (!variable) continue;
        for (const definition of variable.defs) {
          if (workerType((definition.name as WorkerNode).typeAnnotation))
            return true;
          if (
            definition.node.type === "VariableDeclarator" &&
            isWorker(definition.node.init as WorkerNode, seen)
          )
            return true;
        }
        break;
      }
      return node.name === "self" || node.name.toLowerCase().endsWith("worker");
    };
    return {
      NewExpression(node) {
        if (isConstructor(node.callee))
          context.report({ node, messageId: "rpc" });
      },
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== "MemberExpression" ||
          !isWorker(callee.object as WorkerNode)
        )
          return;
        const method = memberName(callee);
        if (
          method === "postMessage" ||
          ((method === "addEventListener" ||
            method === "on" ||
            method === "once") &&
            node.arguments[0]?.type === "Literal" &&
            node.arguments[0].value === "message")
        )
          context.report({ node, messageId: "rpc" });
      },
      AssignmentExpression(node) {
        if (
          node.left.type === "MemberExpression" &&
          memberName(node.left) === "onmessage" &&
          isWorker(node.left.object as WorkerNode)
        )
          context.report({ node, messageId: "rpc" });
      },
    };
  },
};

interface EventNode extends AstNode {
  readonly key?: AstNode;
  readonly source?: AstNode | null;
}

export const noNanoevents: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Require Effect-native events over nanoevents." },
    messages: {
      nanoevents:
        "Expose events as Streams and state: a SubscriptionRef for watched state, a PubSub Stream for occurrences (policies/events.md).",
    },
    schema: [],
  },
  create(context) {
    const check = (node: unknown) => {
      const { source } = node as EventNode;
      if (
        source?.type === "Literal" &&
        typeof source.value === "string" &&
        /(^|\/)nanoevents$/.test(source.value)
      )
        context.report({ node: source as never, messageId: "nanoevents" });
    };
    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    };
  },
};

const CAPABILITY_TAGS: Readonly<Record<string, string>> = {
  vault: "Vault tag (@zotlit/obsidian-kit/obsidian-vault.ts)",
  metadataCache:
    "MetadataCache tag (@zotlit/obsidian-kit/obsidian-metadata-cache.ts)",
  workspace: "Workspace tag (@zotlit/obsidian-kit/obsidian-workspace.ts)",
  fileManager:
    "FileManager tag (@zotlit/obsidian-kit/obsidian-file-manager.ts)",
};

function isApp(node: AstNode | undefined): boolean {
  if (node?.type === "Identifier") return node.name === "app";
  return (
    node?.type === "MemberExpression" &&
    !node.computed &&
    (node.property?.type === "Identifier" ||
      node.property?.type === "PrivateIdentifier") &&
    node.property.name === "app"
  );
}

function appMember(node: AstNode | undefined): string | undefined {
  return node?.type === "MemberExpression" &&
    !node.computed &&
    isApp(node.object) &&
    typeof node.property?.name === "string"
    ? node.property.name
    : undefined;
}

export const obsidianCapabilities: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require the Obsidian capability tags in a file that imports Effect.",
    },
    messages: {
      capability:
        "Read `app.{{name}}` through the {{tag}}; a file that imports Effect takes Obsidian from the capability tags (policies/events.md → Obsidian events).",
      event:
        "Take `app.{{name}}` events from its capability tag's `changes` Stream (Vault, MetadataCache, Workspace); an event the tag does not expose enters through obsidianEvents from @zotlit/obsidian-kit/effect-obsidian-events.ts (policies/events.md → Obsidian events).",
      registerEvent:
        "Take Obsidian events from a capability tag's `changes` Stream, or, for a source or event with no tag yet, from obsidianEvents in @zotlit/obsidian-kit/effect-obsidian-events.ts: one ordered intake with a failure boundary per event (policies/events.md → Obsidian events).",
    },
    schema: [],
  },
  create(context) {
    let effectNative = false;
    const isAppOn = (node: AstNode | undefined) =>
      node?.type === "MemberExpression" &&
      !node.computed &&
      node.property?.name === "on" &&
      appMember(node.object) !== undefined;
    return {
      Program(program) {
        effectNative = isEffectCode(
          (program as ModuleProgram).body ?? [],
          context.sourceCode.text,
        );
      },
      MemberExpression(node) {
        if (!effectNative) return;
        const name = appMember(node);
        const tag = name === undefined ? undefined : CAPABILITY_TAGS[name];
        if (!tag || isAppOn(node.parent)) return;
        context.report({
          node: node,
          messageId: "capability",
          data: { name: name!, tag },
        });
      },
      CallExpression(node) {
        if (!effectNative) return;
        const callee = node.callee as AstNode;
        if (
          (callee.type === "Identifier" && callee.name === "registerEvent") ||
          (callee.type === "MemberExpression" &&
            !callee.computed &&
            callee.property?.name === "registerEvent")
        )
          context.report({ node, messageId: "registerEvent" });
        else if (isAppOn(callee))
          context.report({
            node: callee as never,
            messageId: "event",
            data: { name: String(appMember(callee.object)) },
          });
      },
    };
  },
};

const FUNCTION_TYPES = new Set([
  "FunctionExpression",
  "FunctionDeclaration",
  "ArrowFunctionExpression",
]);

export const layerStreamConsumer: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require forkEach for a Stream consumer in a layer body.",
    },
    messages: {
      forkEach:
        "Consume the Stream with `yield* forkEach(stream, handle)` from @zotlit/plugin-kernel/effect-stream.ts so the layer's Scope owns it (policies/events.md).",
    },
    schema: [],
  },
  create(context) {
    const inLayerBody = (node: AstNode) => {
      for (let at = node.parent; at; at = at.parent)
        if (FUNCTION_TYPES.has(at.type)) return isEffectGenerator(at);
      return false;
    };
    return {
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "subscribe" &&
          inLayerBody(node)
        )
          context.report({ node, messageId: "forkEach" });
      },
    };
  },
};

const CAUSE_OR_EXIT = new Set(["Cause", "Exit"]);

export const interruptPredicate: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require hasInterruptsOnly to tell shutdown from failure.",
    },
    messages: {
      only: "Use `hasInterruptsOnly`: a cause with an interrupt and a failure is a failure.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          isMemberOf(
            node.callee,
            CAUSE_OR_EXIT,
            (name) => name === "hasInterrupts",
          )
        )
          context.report({ node, messageId: "only" });
      },
    };
  },
};

function isStateTag(node: AstNode | undefined): boolean {
  return (
    node?.type === "MemberExpression" &&
    node.property?.name === "_tag" &&
    node.object?.type === "MemberExpression" &&
    node.object.property?.name === "state"
  );
}

export const scopeClosed: Rule = {
  meta: {
    type: "suggestion",
    docs: { description: "Require isScopeClosed to test a closed Scope." },
    messages: {
      helper:
        "Test the Scope with `isScopeClosed(scope)` from @zotlit/plugin-kernel/effect-scope.ts.",
    },
    schema: [],
  },
  create(context) {
    const closed = (side: AstNode | undefined) =>
      side?.type === "Literal" && side.value === "Closed";
    return {
      BinaryExpression(node) {
        const left = node.left as AstNode;
        const right = node.right as AstNode;
        if (
          (isStateTag(left) && closed(right)) ||
          (isStateTag(right) && closed(left))
        )
          context.report({ node, messageId: "helper" });
      },
    };
  },
};

const DEFAULT_RUNTIME_CALLS = new Set([
  "runSync",
  "runPromise",
  "runFork",
  "runPromiseExit",
  "runSyncExit",
  "runCallback",
]);

const EFFECT_SOURCES = new Set(["effect"]);

interface ImportNode extends AstNode {
  readonly source?: AstNode;
  readonly specifiers?: readonly (AstNode & {
    readonly imported?: AstNode;
    readonly local?: AstNode;
  })[];
}

export const noDefaultRuntime: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Forbid running an Effect with an empty context.",
    },
    messages: {
      empty:
        "run the Effect through the plugin's bridge, a layer's context runner or a runtime; `Effect.{{name}}` runs it with an empty context, so its logs skip the plugin logger",
    },
    schema: [],
  },
  create(context) {
    const effectNames = new Set<string>();
    return {
      ImportDeclaration: collectEffectNames(effectNames),
      CallExpression(node) {
        const callee = node.callee as AstNode;
        if (
          isMemberOf(callee, effectNames, (name) =>
            DEFAULT_RUNTIME_CALLS.has(name),
          )
        )
          context.report({
            node: callee as never,
            messageId: "empty",
            data: { name: String(callee.property?.name) },
          });
      },
    };
  },
};

function collectEffectNames(names: Set<string>) {
  return (node: AstNode): void => {
    const { source, specifiers } = node as unknown as ImportNode;
    if (typeof source?.value !== "string" || !EFFECT_SOURCES.has(source.value))
      return;
    for (const specifier of specifiers ?? []) {
      if (
        specifier.type === "ImportSpecifier" &&
        specifier.imported?.name === "Effect" &&
        typeof specifier.local?.name === "string"
      )
        names.add(specifier.local.name);
    }
  };
}

const CAPTURED_RUNNERS = new Set(["runPromiseWith", "runPromiseExitWith"]);

export const scopedRunner: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid a Promise runner over a captured context in a service.",
    },
    messages: {
      captured:
        "build the runner on a Scope (`scopedBridge`, `forkedBridge`, `FiberSet.runtime`, or `effectBridge(runtime)`); `Effect.{{name}}` runs outside every Scope, so unload leaves its runs going",
    },
    schema: [],
  },
  create(context) {
    const effectNames = new Set<string>();
    return {
      ImportDeclaration: collectEffectNames(effectNames),
      CallExpression(node) {
        const callee = node.callee as AstNode;
        if (
          isMemberOf(callee, effectNames, (name) => CAPTURED_RUNNERS.has(name))
        )
          context.report({
            node: callee as never,
            messageId: "captured",
            data: { name: String(callee.property?.name) },
          });
      },
    };
  },
};

interface TypeNode extends AstNode {
  readonly typeAnnotation?: TypeNode;
  readonly returnType?: TypeNode;
  readonly typeName?: TypeNode;
  readonly left?: TypeNode;
  readonly right?: TypeNode;
  readonly members?: readonly TypeNode[];
  readonly types?: readonly TypeNode[];
  readonly body?: TypeNode | readonly TypeNode[];
  readonly declaration?: TypeNode | null;
  readonly declarations?: readonly TypeNode[];
  readonly id?: TypeNode;
  readonly init?: TypeNode | null;
  readonly params?: readonly TypeNode[];
  readonly key?: TypeNode;
  readonly extends?: readonly TypeNode[];
  readonly expression?: TypeNode;
}

function isTemporalType(node: TypeNode | undefined, name: string): boolean {
  const type = node?.type === "TSTypeReference" ? node.typeName : undefined;
  return (
    type?.type === "TSQualifiedName" &&
    type.left?.type === "Identifier" &&
    type.left.name === "Temporal" &&
    type.right?.name === name
  );
}

function isClockFunction(node: TypeNode | undefined): boolean {
  if (!node) return false;
  if (node.type === "TSUnionType")
    return (node.types ?? []).some(isClockFunction);
  if (node.type !== "TSFunctionType") return false;
  const returned = node.returnType?.typeAnnotation;
  return (
    returned?.type === "TSNumberKeyword" || isTemporalType(returned, "Instant")
  );
}

function isNowMember(member: TypeNode): boolean {
  const key = member.computed ? undefined : member.key;
  if (key?.type !== "Identifier" || key.name !== "now") return false;
  if (member.type === "TSMethodSignature") {
    const returned = member.returnType?.typeAnnotation;
    return (
      returned?.type === "TSNumberKeyword" ||
      isTemporalType(returned, "Instant")
    );
  }
  return (
    member.type === "TSPropertySignature" &&
    isClockFunction(member.typeAnnotation?.typeAnnotation)
  );
}

const ANNOTATION_SERVICES =
  /\/annotations\/src\/(core|obsidian|desktop)\/(annotation-repository|attachment-open|excerpt-image|pdf-annotation-editor|reader-session)\//;

const CITATION_SERVICES =
  /\/citations\/src\/(core|obsidian|desktop)\/(annotation-popover|citation-index|citation-parse|citation-popover|citation-text|citekey-editor|citekey-navigation|citekey-reading|graph-citations|pandoc|wikilink-editor|wikilink-reading)\//;

const NOTES_SERVICES =
  /\/(notes\/src\/(core|obsidian|desktop)\/(note-feature|note-import|profile|profile-selection|template|batch)\/|template-workbench\/src\/((core|obsidian|desktop)\/cli\/|desktop\/view\/customize\.ts))/;
const QUERY_SERVICES =
  /\/(query-views\/src\/(core|obsidian|desktop)\/item-query|library-view\/src\/(core|obsidian|desktop)\/release)\//;

export const clockTime: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Read time through Clock in a file that imports Effect.",
    },
    messages: {
      clock:
        "read time through `Clock` (`Clock.currentTimeMillis` or `DateTime.now` in Effect code; `instantClock(yield* Clock.Clock)` from `@zotlit/plugin-kernel/effect-clock.ts` for a non-Effect core), so a TestClock drives it",
      option:
        "do not take a `now` option; read time through `Clock` (`instantClock(yield* Clock.Clock)` from `@zotlit/plugin-kernel/effect-clock.ts`), so a TestClock drives it",
    },
    schema: [],
  },
  create(context) {
    let effectNative = false;
    let declarations: readonly TypeNode[] = [];
    const filename = context.filename.replaceAll(sep, "/");
    const inServices =
      filename.includes("/src/services/") ||
      filename.includes("/plugin-services/src/") ||
      ANNOTATION_SERVICES.test(filename) ||
      CITATION_SERVICES.test(filename) ||
      NOTES_SERVICES.test(filename) ||
      QUERY_SERVICES.test(filename);

    const membersOf = (
      type: TypeNode | undefined,
      seen = new Set<TypeNode>(),
    ): readonly TypeNode[] => {
      if (!type || seen.has(type)) return [];
      seen.add(type);
      switch (type.type) {
        case "TSTypeLiteral":
          return type.members ?? [];
        case "TSIntersectionType":
        case "TSUnionType":
          return (type.types ?? []).flatMap((part) => membersOf(part, seen));
        case "TSInterfaceDeclaration": {
          const body = type.body as TypeNode | undefined;
          return body?.type === "TSInterfaceBody"
            ? ((body.body as readonly TypeNode[] | undefined) ?? [])
            : [];
        }
        case "TSTypeAliasDeclaration":
          return membersOf(type.typeAnnotation, seen);
        case "TSTypeReference": {
          const name = type.typeName;
          if (name?.type !== "Identifier") return [];
          return declarations
            .filter((declaration) => declaration.id?.name === name.name)
            .flatMap((declaration) => membersOf(declaration, seen));
        }
        default:
          return [];
      }
    };

    const hasNowOption = (param: TypeNode): boolean => {
      const target = param.type === "AssignmentPattern" ? param.left : param;
      if (
        target?.type === "Identifier" &&
        target.name === "now" &&
        isClockFunction(target.typeAnnotation?.typeAnnotation)
      )
        return true;
      return membersOf(target?.typeAnnotation?.typeAnnotation).some(
        isNowMember,
      );
    };

    const checkLayer = (name: unknown, fn: TypeNode | null | undefined) => {
      if (
        !inServices ||
        typeof name !== "string" ||
        !name.startsWith("layer") ||
        (fn?.type !== "FunctionDeclaration" &&
          fn?.type !== "FunctionExpression" &&
          fn?.type !== "ArrowFunctionExpression")
      )
        return;
      for (const param of fn.params ?? [])
        if (hasNowOption(param))
          context.report({ node: param as never, messageId: "option" });
    };

    return {
      Program(program) {
        const body = (program as ModuleProgram).body ?? [];
        effectNative = isEffectCode(body, context.sourceCode.text);
        declarations = body.flatMap((statement) => {
          const node = statement as TypeNode;
          const declaration =
            node.type === "ExportNamedDeclaration" ? node.declaration : node;
          return declaration?.type === "TSInterfaceDeclaration" ||
            declaration?.type === "TSTypeAliasDeclaration"
            ? [declaration]
            : [];
        });
      },
      ExportNamedDeclaration(node) {
        const declaration = (node as TypeNode).declaration;
        if (declaration?.type === "FunctionDeclaration")
          checkLayer(declaration.id?.name, declaration);
        if (declaration?.type === "VariableDeclaration")
          for (const declarator of declaration.declarations ?? [])
            checkLayer(declarator.id?.name, declarator.init);
      },
      CallExpression(node) {
        if (!effectNative) return;
        const callee = node.callee as TypeNode;
        const system =
          isMemberOf(callee, DATE, (name) => name === "now") ||
          isMemberOf(callee, PERFORMANCE, (name) => name === "now");
        if (system) context.report({ node, messageId: "clock" });
      },
      NewExpression(node) {
        const callee = node.callee as TypeNode;
        if (
          effectNative &&
          callee.type === "Identifier" &&
          callee.name === "Date" &&
          node.arguments.length === 0
        )
          context.report({ node, messageId: "clock" });
      },
    };
  },
};

function isTemporalRoot(node: TypeNode): boolean {
  const parent: TypeNode | null | undefined = node.parent;
  return (
    (parent?.type === "MemberExpression" && parent.object === node) ||
    (parent?.type === "TSQualifiedName" && parent.left === node)
  );
}

export const temporalInEffect: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Use Effect's DateTime, not Temporal, in a file that imports Effect.",
    },
    messages: {
      temporal:
        "use Effect's `DateTime` in Effect code (`DateTime.Utc` for an instant, `DateTime.Zoned` where the zone matters, `DateTime.now` or `Clock` for the current time) and `Duration` for a span; plain code that keeps `Temporal` converts at the edge with `@zotlit/plugin-kernel/effect-clock.ts`",
    },
    schema: [],
  },
  create(context) {
    let effectNative = false;
    return {
      Program(program) {
        effectNative = isEffectCode(
          (program as ModuleProgram).body ?? [],
          context.sourceCode.text,
        );
      },
      Identifier(node) {
        const identifier = node as unknown as TypeNode;
        if (
          effectNative &&
          identifier.name === "Temporal" &&
          isTemporalRoot(identifier)
        )
          context.report({ node, messageId: "temporal" });
      },
    };
  },
};

export const noPlainServiceAdapters: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid a `<service>/plain` adapter; read the service's Effect tag.",
    },
    messages: {
      adapter:
        "Read the Effect service tag, and from outside Effect run its calls through the runtime's `bridge` (policies/services.md → Bridge).",
    },
    schema: [],
  },
  create(context) {
    const check = (node: unknown) => {
      const source = node as { readonly source?: { readonly value?: unknown } };
      const value = source.source?.value;
      if (typeof value !== "string") return;
      const path = value.startsWith(".")
        ? resolve(dirname(context.filename), value).split(sep).join("/")
        : value;
      if (
        (path.startsWith("@/services/") ||
          path.startsWith("@zotlit/plugin-services/") ||
          path.startsWith("@zotlit/annotations/") ||
          path.startsWith("@zotlit/citations/") ||
          path.startsWith("@zotlit/notes/") ||
          path.startsWith("@zotlit/template-workbench/") ||
          path.startsWith("@zotlit/query-views/") ||
          path.startsWith("@zotlit/library-view/") ||
          path.includes("/src/services/") ||
          path.includes("/plugin-services/src/") ||
          path.includes("/annotations/src/") ||
          path.includes("/citations/src/") ||
          path.includes("/notes/src/") ||
          path.includes("/template-workbench/src/") ||
          path.includes("/query-views/src/") ||
          path.includes("/library-view/src/")) &&
        ["plain", "plain.ts", "plain.js"].includes(path.split("/").at(-1)!)
      )
        context.report({ node: node as never, messageId: "adapter" });
    };
    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    };
  },
};

export default {
  meta: { name: "zotlit-services" },
  rules: {
    "cli-command-registration": cliCommandRegistration,
    "clock-time": clockTime,
    "effect-native-resources": effectNativeResources,
    "interrupt-predicate": interruptPredicate,
    "layer-stream-consumer": layerStreamConsumer,
    "no-default-runtime": noDefaultRuntime,
    "no-legacy-service": noLegacyService,
    "no-nanoevents": noNanoevents,
    "no-plain-service-adapters": noPlainServiceAdapters,
    "obsidian-capabilities": obsidianCapabilities,
    "scope-closed": scopeClosed,
    "scoped-runner": scopedRunner,
    "service-tag-id": serviceTagId,
    "temporal-in-effect": temporalInEffect,
    "worker-rpc": workerRpc,
  },
};
