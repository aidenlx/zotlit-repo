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

/** The settings of the build constants these services and the kernel read. */
export const buildConstants = {
  __PLUGIN_ID__: JSON.stringify("zotlit"),
  __DEV__: JSON.stringify(true),
  __WEB_WORKBENCH_ENABLED__: JSON.stringify(true),
  __ANNOTATION_SUGGESTER_ENABLED__: JSON.stringify(true),
  __DOCS_SITE_URL__: JSON.stringify("https://zotlit.aidenlx.site"),
  __CHINESE_SEGMENTER__: JSON.stringify({
    version: "0.0.0",
    url: "https://example.invalid/jieba_rs_wasm_bg.wasm",
    sha256: "0".repeat(64),
  }),
};

/** The plugin code the effectEntry wrappers apply to. */
export const pluginCode = [
  fileURLToPath(new URL("./src/", import.meta.url)),
  packageSource(import.meta.resolve("@zotlit/obsidian-kit/package.json")),
  packageSource(import.meta.resolve("@zotlit/obsidian-desktop/package.json")),
  packageSource(import.meta.resolve("@zotlit/zotero-reads/package.json")),
];

export default defineConfig({
  resolve: {
    alias: {
      // The services read the Obsidian kit and `obsidian`, a types-only
      // package; runtime imports load the stand-in.
      obsidian: obsidianMock,
    },
  },
  // The build constants, as the plugin's own test config defines them.
  define: buildConstants,
  plugins: [
    effectEntry("renderer", { vitest: true, scopes: pluginCode }),
    // The view atoms of the Obsidian kit import `react`, which the plugin
    // bundles as Preact.
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
