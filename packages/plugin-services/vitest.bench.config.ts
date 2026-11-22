import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";
import { obsidianMock, obsidianSetupFile } from "@zotlit/obsidian-kit/vitest";
import { effectEntry } from "@zotlit/plugin-kernel/vite";

import { buildConstants, pluginCode } from "./vitest.config.ts";

export default defineConfig({
  resolve: { alias: { obsidian: obsidianMock } },
  define: buildConstants,
  plugins: [effectEntry("renderer", { vitest: true, scopes: pluginCode })],
  test: {
    ...testDefaults,
    include: ["src/**/*.bench.ts"],
    environment: "node",
    setupFiles: [obsidianSetupFile],
    testTimeout: 0,
    fileParallelism: false,
  },
});
