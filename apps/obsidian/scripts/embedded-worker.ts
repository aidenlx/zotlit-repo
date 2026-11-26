import { build } from "vite";
import type { InlineConfig, Plugin } from "vite";

import { checkRequires } from "@zotlit/scripts/bundle-gate";
import { PLATFORM_MODULES } from "@zotlit/scripts/runtime-table";
import type { Runtime } from "@zotlit/scripts/runtime-table";

export interface EmbeddedWorkerOptions {
  id: string;
  entry: string;
  runtime: Runtime;
  config: Pick<InlineConfig, "define" | "resolve" | "mode" | "plugins"> & {
    minify: boolean;
    sourcemap: boolean | "inline";
    target: string;
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
            ],
            output: { codeSplitting: false, strictExecutionOrder: true },
          },
        },
      });
      const outputs = Array.isArray(result) ? result : [result];
      const chunk = outputs
        .flatMap((output) => ("output" in output ? output.output : []))
        .find((item) => item.type === "chunk");
      if (!chunk)
        this.error(`The worker build of ${options.entry} emitted no chunk`);
      const { failures } = checkRequires(
        "worker.js",
        chunk.code,
        options.runtime,
      );
      if (failures.length > 0) {
        this.error(
          `The worker bundle of ${options.entry} breaks its runtime:\n${failures.join("\n")}`,
        );
      }
      for (const moduleId of chunk.moduleIds) {
        if (!moduleId.startsWith("\0")) this.addWatchFile(moduleId);
      }
      const scoped = `(() => {${chunk.code}\n})();\n`;
      return `export default ${JSON.stringify(scoped)};`;
    },
  };
}
