import { regex } from "arkregex";
import { build } from "vite";
import type { InlineConfig, Plugin } from "vite";

export interface EmbeddedWorkerOptions {
  id: string;
  entry: string;
  config: Pick<InlineConfig, "define" | "resolve" | "mode" | "plugins"> & {
    external: string[];
    minify: boolean;
    sourcemap: boolean | "inline";
    target: string;
  };
}

const FORBIDDEN_REQUIRE = regex(
  `\\brequire\\(\\s*["'](?<module>obsidian|electron)["']\\s*\\)`,
);

export function embeddedWorker(options: EmbeddedWorkerOptions): Plugin {
  const resolvedId = `\0${options.id}`;
  const { external, minify, sourcemap, target, ...shared } = options.config;
  return {
    name: "embedded-worker",
    resolveId(id) {
      return id === options.id ? resolvedId : null;
    },
    async load(id) {
      if (id !== resolvedId) return null;
      const result = await build({
        ...shared,
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
            external: ["obsidian", "electron", ...external],
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
      const forbidden = FORBIDDEN_REQUIRE.exec(chunk.code);
      if (forbidden) {
        this.error(
          `The worker bundle of ${options.entry} requires "${forbidden.groups.module}", which a worker cannot load`,
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
