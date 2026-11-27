import { builtinModules } from "node:module";
import { constants, deflateRawSync } from "node:zlib";
import type { InlineConfig, Plugin } from "vite";
import { build, parseSync } from "vite";

import { checkRequires } from "@zotlit/scripts/bundle-gate";
import { PLATFORM_MODULES } from "@zotlit/scripts/runtime-table";
import type { Runtime } from "@zotlit/scripts/runtime-table";

import { checkLoads } from "./worker-loads.ts";
import { bundledNotice, isLegalComment } from "./worker-notices.ts";

export interface EmbeddedWorkerOptions {
  id: string;
  entry: string;
  runtime: Runtime;
  form?: "string" | "deflated";
  notices?: { readonly fallbacks: string };
  scriptUrlGlobal?: string;
  config: Pick<InlineConfig, "define" | "resolve" | "mode" | "plugins"> & {
    minify: boolean;
    sourcemap: boolean | "inline";
    target: string | string[];
  };
}

export function embeddedWorker(options: EmbeddedWorkerOptions): Plugin {
  const resolvedId = `\0${options.id}`;
  const { minify, sourcemap, target, ...shared } = options.config;
  return {
    name: "embedded-worker",
    resolveId(id) {
      return id === options.id ? resolvedId : null;
    },
    async load(id) {
      if (id !== resolvedId) return null;
      const result = await build({
        ...shared,
        resolve: {
          ...shared.resolve,
          conditions: [...options.runtime.conditions],
        },
        configFile: false,
        logLevel: "warn",
        build: {
          write: false,
          reportCompressedSize: false,
          emptyOutDir: false,
          copyPublicDir: false,
          minify,
          sourcemap,
          target,
          lib: {
            entry: options.entry,
            formats: ["cjs"],
            fileName: () => "worker.js",
          },
          rolldownOptions: {
            external: [
              ...Object.entries(PLATFORM_MODULES)
                .filter(([, capability]) => capability !== "node")
                .map(([name]) => name),
              ...options.runtime.modules,
              ...builtinModules.flatMap((name) => [name, `node:${name}`]),
            ],
            output: {
              codeSplitting: false,
              strictExecutionOrder: true,
              comments: { legal: Boolean(options.notices), annotation: false },
            },
          },
        },
      });
      const outputs = Array.isArray(result) ? result : [result];
      const chunk = outputs
        .flatMap((output) => ("output" in output ? output.output : []))
        .find((item) => item.type === "chunk");
      if (!chunk)
        this.error(`The worker build of ${options.entry} emitted no chunk`);
      const { program, comments } = parseSync("worker.js", chunk.code);
      const notice = options.notices
        ? await bundledNotice(
            chunk.moduleIds,
            comments,
            options.notices.fallbacks,
          )
        : { notice: "", failures: [] };
      const failures = [
        ...(options.runtime.modules.length > 0
          ? checkRequires("worker.js", chunk.code, options.runtime).failures
          : []),
        ...checkLoads(program, options),
        ...notice.failures,
      ];
      if (failures.length > 0) {
        this.error(
          `The worker bundle of ${options.entry} breaks its runtime:\n${failures.join("\n")}`,
        );
      }
      for (const moduleId of chunk.moduleIds) {
        if (!moduleId.startsWith("\0")) this.addWatchFile(moduleId);
      }
      let code = chunk.code;
      for (const comment of comments.filter(isLegalComment).toReversed())
        code = code.slice(0, comment.start) + code.slice(comment.end);
      const scoped = `${notice.notice}(() => {${code}\n})();\n`;
      if (options.form !== "deflated")
        return `export default ${JSON.stringify(scoped)};`;
      const deflated = deflateRawSync(scoped, {
        level: constants.Z_BEST_COMPRESSION,
      }).toString("base64");
      return `export default () => ${JSON.stringify(deflated)};`;
    },
  };
}
