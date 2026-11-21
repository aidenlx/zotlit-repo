// The benchmarks of the plugin: `src/**/*.bench.ts`, which build large
// databases and take minutes, so `pnpm test` (vitest.config.ts) leaves them
// out. Run with `pnpm --filter @zotlit/obsidian bench`.
//
// It repeats the `resolve`, `define` and `plugins` of vitest.config.ts rather
// than merging that file: its `projects` would carry their `include` here.
import preact from "@preact/preset-vite";
import { join, resolve } from "node:path";
import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";
import { obsidianMock, obsidianSetupFile } from "@zotlit/obsidian-kit/vitest";
import { effectEntry } from "@zotlit/plugin-kernel/vite";
import { PLUGIN_KERNEL, pluginPackages } from "@zotlit/scripts/plugin-packages";

const packageRoot = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      obsidian: obsidianMock,
      "virtual:citation-parse-worker": resolve(
        packageRoot,
        "__mocks__/worker-source.ts",
      ),
      "virtual:zotero-reads-worker": resolve(
        packageRoot,
        "__mocks__/worker-source.ts",
      ),
    },
    tsconfigPaths: true,
  },
  define: {
    __PLUGIN_ID__: JSON.stringify("zotlit"),
    __DEV__: JSON.stringify(true),
    __ANNOTATION_SUGGESTER_ENABLED__: JSON.stringify(true),
    __DOCS_SITE_URL__: JSON.stringify("https://zotlit.aidenlx.site"),
  },
  plugins: [
    effectEntry("renderer", {
      vitest: true,
      scopes: [
        resolve(packageRoot, "src"),
        resolve(packageRoot, "scripts"),
        ...pluginPackages(packageRoot)
          .filter(({ name }) => name !== PLUGIN_KERNEL)
          .map(({ root }) => join(root, "src")),
      ],
    }),
    preact(),
  ],
  test: {
    ...testDefaults,
    include: ["src/**/*.bench.ts"],
    environment: "node",
    setupFiles: [obsidianSetupFile],
    // One grid runs for many minutes; the bench sets its own per-test timeout.
    testTimeout: 0,
    fileParallelism: false,
  },
});
