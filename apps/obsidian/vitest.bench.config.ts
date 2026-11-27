import preact from "@preact/preset-vite";
import { join, resolve } from "node:path";
import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";
import { obsidianMock, obsidianSetupFile } from "@zotlit/obsidian-kit/vitest";
import { effectEntry } from "@zotlit/plugin-kernel/vite";
import { PLUGIN_KERNEL, pluginPackages } from "@zotlit/scripts/plugin-packages";

import { SQLITE_ENGINE_VERSION } from "./scripts/sqlite-engine.ts";

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
      "virtual:zotero-reads-web-worker": resolve(
        packageRoot,
        "__mocks__/worker-thunk.ts",
      ),
      "virtual:temporal-piece": resolve(
        packageRoot,
        "__mocks__/temporal-piece.ts",
      ),
    },
    tsconfigPaths: true,
  },
  define: {
    __PLUGIN_ID__: JSON.stringify("zotlit"),
    __DEV__: JSON.stringify(true),
    __ANNOTATION_SUGGESTER_ENABLED__: JSON.stringify(true),
    __DOCS_SITE_URL__: JSON.stringify("https://zotlit.aidenlx.site"),
    __SQLITE_ENGINE_VERSION__: JSON.stringify(SQLITE_ENGINE_VERSION),
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
    testTimeout: 0,
    fileParallelism: false,
  },
});
