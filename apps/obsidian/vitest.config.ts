import preact from "@preact/preset-vite";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { pandocFilterVariants } from "@zotlit/citations/vite";
import { testDefaults } from "@zotlit/config/vitest";
import { obsidianMock, obsidianSetupFile } from "@zotlit/obsidian-kit/vitest";
import { effectEntry } from "@zotlit/plugin-kernel/vite";
import { PLUGIN_KERNEL, pluginPackages } from "@zotlit/scripts/plugin-packages";

import { SQLITE_ENGINE_VERSION } from "./scripts/sqlite-engine.ts";

const packageRoot = import.meta.dirname;

const HAPPY_DOM_NATIVE_RESPONSE_FILES = [
  "src/services/citations/citation-locale.integration.test.ts",
  "src/services/citations/citation-presentation.integration.test.ts",
  "src/services/citations/document-language.integration.test.ts",
  "src/services/citations/document-citation-set.integration.test.ts",
];

export default defineConfig({
  resolve: {
    alias: {
      obsidian: obsidianMock,
      "@chenglou/pretext": fileURLToPath(
        import.meta
          .resolve("@zotlit/query-views/package.json")
          .replace(/package\.json$/, "__mocks__/pretext.ts"),
      ),
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
    pandocFilterVariants(),
  ],
  test: {
    ...testDefaults,
    environment: "node",
    clearMocks: true,
    server: {
      deps: {
        inline: [
          "@effect/atom-react",
          "@uiw/react-codemirror",
          "@tanstack/react-virtual",
        ],
      },
    },
    setupFiles: [obsidianSetupFile],
    globalSetup: [
      ...testDefaults.globalSetup,
      fileURLToPath(
        import.meta.resolve("@zotlit/plugin-messages/vitest-setup"),
      ),
    ],
    projects: [
      {
        extends: true,
        test: {
          include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
          exclude: [
            ...testDefaults.exclude,
            ...HAPPY_DOM_NATIVE_RESPONSE_FILES,
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "happy-dom-native-response",
          include: HAPPY_DOM_NATIVE_RESPONSE_FILES,
          environment: "./vitest.env.happy-dom-native-response.ts",
        },
      },
    ],
  },
});
