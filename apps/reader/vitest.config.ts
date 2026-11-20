import preact from "@preact/preset-vite";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";
import { obsidianMock, obsidianSetupFile } from "@zotlit/obsidian-kit/vitest";
import { effectEntry } from "@zotlit/plugin-kernel/vite";
import { READER_MESSAGES_DIRECTORY } from "@zotlit/reader-messages/language-pack-options";
import { PLUGIN_KERNEL, pluginPackages } from "@zotlit/scripts/plugin-packages";

import { buildDefines } from "./build-defines.ts";

const packageRoot = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      obsidian: obsidianMock,
      "@zotlit/plugin-messages": READER_MESSAGES_DIRECTORY,
      "@zotlit/pdfjs/viewer": resolve(packageRoot, "__mocks__/pdfjs-viewer.ts"),
    },
  },
  define: buildDefines(true),
  plugins: [
    effectEntry("renderer", {
      vitest: true,
      scopes: [
        resolve(packageRoot, "src"),
        ...pluginPackages(packageRoot)
          .filter(({ name }) => name !== PLUGIN_KERNEL)
          .map(({ root }) => join(root, "src")),
      ],
    }),
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
        import.meta.resolve("@zotlit/reader-messages/vitest-setup"),
      ),
    ],
  },
});
