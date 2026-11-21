import preact from "@preact/preset-vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";
import { effectEntry } from "@zotlit/plugin-kernel/vite";

import { obsidianMock, obsidianSetupFile } from "./vitest.preset.ts";

export default defineConfig({
  resolve: {
    alias: {
      // The published `obsidian` package is types-only; runtime imports of it
      // load the stand-in.
      obsidian: obsidianMock,
    },
    tsconfigPaths: true,
  },
  // The build constants the kernel reads, as the plugin's own test config
  // defines them.
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
        // Run through Vite so its `react` import lands on the Preact alias
        // like our own sources; externalized, it would load real React.
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
