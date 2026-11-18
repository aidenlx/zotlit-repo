import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";
import {
  obsidianMock,
  obsidianSetupFile,
  packageSource,
} from "@zotlit/obsidian-kit/vitest";
import { effectEntry } from "@zotlit/plugin-kernel/vite";

export default defineConfig({
  resolve: {
    alias: {
      // The client layer reads the Obsidian kit, whose modules import the
      // types-only `obsidian` package; runtime imports load the stand-in.
      obsidian: obsidianMock,
    },
  },
  // The build constants the kernel reads, as the plugin's own test config
  // defines them.
  define: {
    __WEB_WORKBENCH_ENABLED__: JSON.stringify(true),
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
