import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";
import { obsidianMock } from "@zotlit/obsidian-kit/vitest";

export default defineConfig({
  resolve: {
    alias: {
      obsidian: obsidianMock,
    },
  },
  test: {
    ...testDefaults,
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
