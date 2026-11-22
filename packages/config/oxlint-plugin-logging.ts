import { sep } from "node:path";

import { hasSource } from "./oxlint-ast.ts";
import type { AstNode, ModuleStatement, Rule } from "./oxlint-ast.ts";

const LOGTAPE_MODULE = "@logtape/logtape";
const KERNEL_PACKAGE = "@zotlit/plugin-kernel/";
const KERNEL_SOURCE = `${sep}plugin-kernel${sep}src${sep}`;

const TEST_FILE =
  /\.(?:test|browser-test|bench)\.tsx?$|[\\/]__fixtures__[\\/]/u;

const CONSOLE_SINKS = [
  `${KERNEL_SOURCE}log-console.ts`,
  `${KERNEL_SOURCE}effect-log-port.ts`,
];

interface ImportNode extends ModuleStatement {
  readonly specifiers?: readonly (AstNode & {
    readonly imported?: AstNode;
    readonly local?: AstNode;
  })[];
}

const isKernelSource = (source: string, filename: string) =>
  source.startsWith(KERNEL_PACKAGE) ||
  (filename.includes(KERNEL_SOURCE) &&
    (source.startsWith("#") || source.startsWith(".")));

const namesGetLogger = (statement: ImportNode) =>
  (statement.specifiers ?? []).some(
    (specifier) =>
      (specifier.imported ?? specifier.local)?.name === "getLogger",
  );

export const effectLoggingOnly: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Log through Effect's logging API only.",
    },
    messages: {
      logtape:
        "log through Effect (`Effect.log*`, `withLogCategory`); the Obsidian plugins import no LogTape",
      getLogger:
        "log through Effect (`Effect.log*`, `withLogCategory`) run on a bridge or `Effect.runSyncWith(logServices)`; the kernel has no getLogger",
      console:
        "log through Effect (`Effect.log*`); only the plugin logger's console sink writes the console",
    },
    schema: [],
  },
  create(context) {
    const consoleAllowed =
      TEST_FILE.test(context.filename) ||
      CONSOLE_SINKS.some((sink) => context.filename.endsWith(sink));
    const checkSource = (node: ImportNode) => {
      const source = node.source?.value;
      if (typeof source !== "string") return;
      if (source === LOGTAPE_MODULE)
        context.report({ node: node as never, messageId: "logtape" });
      else if (isKernelSource(source, context.filename) && namesGetLogger(node))
        context.report({ node: node as never, messageId: "getLogger" });
    };
    return {
      ImportDeclaration(node) {
        checkSource(node);
      },
      ExportNamedDeclaration(node) {
        if (hasSource(node as ImportNode)) checkSource(node as ImportNode);
      },
      ExportAllDeclaration(node) {
        checkSource(node);
      },
      ImportExpression(node) {
        const source = (node as AstNode & { source?: AstNode }).source;
        if (source?.type === "Literal" && source.value === LOGTAPE_MODULE)
          context.report({ node, messageId: "logtape" });
      },
      MemberExpression(node) {
        const member = node as AstNode;
        if (
          !consoleAllowed &&
          member.object?.type === "Identifier" &&
          member.object.name === "console"
        )
          context.report({ node, messageId: "console" });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-logging" },
  rules: { "effect-logging-only": effectLoggingOnly },
};
