import preact from "@preact/preset-vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";
import {
  obsidianMock,
  obsidianSetupFile,
  packageSource,
} from "@zotlit/obsidian-kit/vitest";
import { effectEntry } from "@zotlit/plugin-kernel/vite";

import { pandocFilterVariants } from "./scripts/lua-filter.ts";

const pluginCode = [
  fileURLToPath(new URL("./src/", import.meta.url)),
  fileURLToPath(new URL("./scripts/", import.meta.url)),
  packageSource(import.meta.resolve("@zotlit/obsidian-kit/package.json")),
  packageSource(import.meta.resolve("@zotlit/obsidian-desktop/package.json")),
  packageSource(import.meta.resolve("@zotlit/zotero-reads/package.json")),
  packageSource(import.meta.resolve("@zotlit/plugin-services/package.json")),
  packageSource(import.meta.resolve("@zotlit/annotations/package.json")),
];

export default defineConfig({
  resolve: {
    alias: {
      obsidian: obsidianMock,
    },
  },
  define: {
    __PLUGIN_ID__: JSON.stringify("zotlit"),
    __DEV__: JSON.stringify(true),
    __ANNOTATION_SUGGESTER_ENABLED__: JSON.stringify(true),
    __DOCS_SITE_URL__: JSON.stringify("https://zotlit.aidenlx.site"),
  },
  plugins: [
    effectEntry("renderer", { vitest: true, scopes: pluginCode }),
    preact(),
    pandocFilterVariants(),
  ],
  test: {
    ...testDefaults,
    environment: "node",
    clearMocks: true,
    server: {
      deps: {
        inline: ["@effect/atom-react"],
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
          exclude: [...testDefaults.exclude, "src/**/*.pandoc.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "pandoc",
          include: ["src/**/*.pandoc.test.ts"],
          environment: "happy-dom",
        },
      },
    ],
  },
});
