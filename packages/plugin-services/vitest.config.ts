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

export const buildConstants = {
  __PLUGIN_ID__: JSON.stringify("zotlit"),
  __DEV__: JSON.stringify(true),
  __ANNOTATION_SUGGESTER_ENABLED__: JSON.stringify(true),
  __DOCS_SITE_URL__: JSON.stringify("https://zotlit.aidenlx.site"),
};

export const pluginCode = [
  fileURLToPath(new URL("./src/", import.meta.url)),
  packageSource(import.meta.resolve("@zotlit/obsidian-kit/package.json")),
  packageSource(import.meta.resolve("@zotlit/obsidian-desktop/package.json")),
  packageSource(import.meta.resolve("@zotlit/zotero-reads/package.json")),
];

export default defineConfig({
  resolve: {
    alias: {
      obsidian: obsidianMock,
    },
  },
  define: buildConstants,
  plugins: [
    effectEntry("renderer", { vitest: true, scopes: pluginCode }),
    preact(),
  ],
  test: {
    ...testDefaults,
    include: ["src/**/*.test.ts"],
    environment: "node",
    clearMocks: true,
    setupFiles: [obsidianSetupFile],
    globalSetup: [
      ...testDefaults.globalSetup,
      fileURLToPath(
        import.meta.resolve("@zotlit/plugin-messages/vitest-setup"),
      ),
    ],
  },
});
