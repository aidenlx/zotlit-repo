import { resolve } from "node:path";
import type { MessagePort } from "node:worker_threads";
import { build } from "vite";

import type { ParseRequest } from "@zotlit/citations/core/citation-parse/client.ts";
import { packageSource } from "@zotlit/obsidian-kit/vitest";
import { effectEntry, effectEntryCheck } from "@zotlit/plugin-kernel/vite";

import packageJson from "../package.json" with { type: "json" };
import { embeddedWorker } from "./embedded-worker.ts";

export interface BenchmarkParseClient<Reply> extends AsyncDisposable {
  parse(this: void, request: ParseRequest, signal: AbortSignal): Promise<Reply>;
}

const CLIENT_ENTRY_ID = resolve(import.meta.dirname, "scan-benchmark-entry.js");
const CLIENT_ENTRY = `
export { default } from "virtual:scan-worker";
import { Effect, Scope } from "effect";
import { openScope } from "@zotlit/plugin-kernel/effect-scope.ts";
import { decodeParseReply } from "@zotlit/citations/core/citation-parse/client.ts";
import { makeParseWorkerClient } from "@zotlit/citations/core/citation-parse/worker-client.ts";
export async function connect(spawn, onEncode) {
  const { scope, close } = openScope();
  try {
    const measureEncoding = onEncode && (() => {
      const start = performance.now();
      return () => onEncode(performance.now() - start);
    });
    const client = await Effect.runPromise(makeParseWorkerClient(spawn, measureEncoding).pipe(Scope.provide(scope)));
    return {
      parse: (request, signal) => Effect.runPromise(Effect.suspend(() => client.Parse(request)).pipe(Effect.map(decodeParseReply)), { signal }),
      [Symbol.asyncDispose]: close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
`;

export async function scanWorkerBundle<Reply>(): Promise<{
  default: string;
  connect(
    spawn: () => Pick<
      MessagePort,
      "addEventListener" | "removeEventListener" | "postMessage"
    >,
    onEncode?: (milliseconds: number) => void,
  ): Promise<BenchmarkParseClient<Reply>>;
}> {
  const packageRoot = resolve(import.meta.dirname, "..");
  const resolveConfig = { alias: { "@": resolve(packageRoot, "src") } };
  const define = { __PLUGIN_ID__: JSON.stringify(packageJson.obsidian.id) };
  const scopes = [
    resolve(packageRoot, "src"),
    resolve(packageRoot, "scripts"),
    packageSource(import.meta.resolve("@zotlit/obsidian-kit/package.json")),
    packageSource(import.meta.resolve("@zotlit/obsidian-desktop/package.json")),
    packageSource(import.meta.resolve("@zotlit/zotero-reads/package.json")),
    packageSource(import.meta.resolve("@zotlit/plugin-services/package.json")),
    packageSource(import.meta.resolve("@zotlit/annotations/package.json")),
    packageSource(import.meta.resolve("@zotlit/citations/package.json")),
  ];
  const result = await build({
    configFile: false,
    logLevel: "silent",
    define,
    resolve: resolveConfig,
    plugins: [
      {
        name: "scan-benchmark-entry",
        resolveId: (id) => (id === CLIENT_ENTRY_ID ? id : null),
        load: (id) => (id === CLIENT_ENTRY_ID ? CLIENT_ENTRY : null),
      },
      effectEntry("renderer", { scopes }),
      effectEntryCheck("renderer"),
      embeddedWorker({
        id: "virtual:scan-worker",
        entry: resolve(packageRoot, "src/services/citation-parse/worker.ts"),
        config: {
          define,
          resolve: resolveConfig,
          plugins: [
            effectEntry("worker", { scopes }),
            effectEntryCheck("worker"),
          ],
          external: [],
          minify: false,
          sourcemap: false,
          target: "es2025",
        },
      }),
    ],
    build: {
      write: false,
      lib: { entry: CLIENT_ENTRY_ID, formats: ["es"] },
      rolldownOptions: { input: CLIENT_ENTRY_ID },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs
    .flatMap((output) => ("output" in output ? output.output : []))
    .find((output) => output.type === "chunk");
  if (!chunk) throw new Error("Scanner worker bundle emitted no JavaScript");
  return import(
    `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`
  );
}
