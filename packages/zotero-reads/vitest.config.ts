import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";
import {
  obsidianMock,
  obsidianSetupFile,
  packageSource,
} from "@zotlit/obsidian-kit/vitest";
import { effectEntry } from "@zotlit/plugin-kernel/vite";

const require = createRequire(import.meta.url);
const sqliteWasmBrowserBuild = join(
  dirname(require.resolve("@sqlite.org/sqlite-wasm")),
  "index.mjs",
);

export default defineConfig({
  resolve: {
    alias: [
      { find: "obsidian", replacement: obsidianMock },
      {
        find: /^@sqlite\.org\/sqlite-wasm$/,
        replacement: sqliteWasmBrowserBuild,
      },
    ],
  },
  define: {
    __PLUGIN_ID__: JSON.stringify("zotlit"),
    __ANNOTATION_SUGGESTER_ENABLED__: JSON.stringify(true),
    __DOCS_SITE_URL__: JSON.stringify("https://zotlit.aidenlx.site"),
  },
  plugins: [
    effectEntry("renderer", {
      vitest: true,
      scopes: [
        fileURLToPath(new URL("./src/", import.meta.url)),
        packageSource(import.meta.resolve("@zotlit/obsidian-kit/package.json")),
        packageSource(
          import.meta.resolve("@zotlit/obsidian-desktop/package.json"),
        ),
      ],
    }),
  ],
  test: {
    ...testDefaults,
    include: ["src/**/*.test.ts"],
    environment: "node",
    clearMocks: true,
    setupFiles: [obsidianSetupFile],
  },
});
