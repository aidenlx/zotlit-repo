import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";

import { MOBILE_HOST_BUNDLE } from "@zotlit/scripts/shell/plugins";

import { pluginBuildBase } from "./scripts/build-base.ts";

export default defineConfig(({ mode }) => {
  const {
    resolve: resolveConfig,
    define,
    external,
    rendererPlugins,
  } = pluginBuildBase(mode, MOBILE_HOST_BUNDLE.runtime);

  return {
    resolve: resolveConfig,
    define,
    build: {
      reportCompressedSize: false,
      lib: {
        entry: resolve(
          import.meta.dirname,
          "src/__fixtures__/mobile-host/host.check.ts",
        ),
        formats: ["cjs"],
        fileName: () => "main.js",
        cssFileName: "styles",
      },
      outDir: dirname(MOBILE_HOST_BUNDLE.file),
      emptyOutDir: true,
      minify: false,
      target: "es2025",
      copyPublicDir: false,
      rolldownOptions: {
        external,
        output: { strictExecutionOrder: true, codeSplitting: false },
      },
    },
    plugins: rendererPlugins,
  };
});
