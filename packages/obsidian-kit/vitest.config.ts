import preact from "@preact/preset-vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";
import { effectEntry } from "@zotlit/plugin-kernel/vite";

import { obsidianMock, obsidianSetupFile } from "./vitest.preset.ts";

export default defineConfig({
  resolve: {
    alias: {
      obsidian: obsidianMock,
    },
    tsconfigPaths: true,
  },
  define: {
    __PLUGIN_ID__: JSON.stringify("zotlit"),
    __ANNOTATION_SUGGESTER_ENABLED__: JSON.stringify(true),
    __DOCS_SITE_URL__: JSON.stringify("https://zotlit.aidenlx.site"),
  },
  plugins: [
    effectEntry("renderer", {
      vitest: true,
      scopes: [fileURLToPath(new URL("./src/", import.meta.url))],
    }),
    preact(),
  ],
  test: {
    ...testDefaults,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
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
  },
});
