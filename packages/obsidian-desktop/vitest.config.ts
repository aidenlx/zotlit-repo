import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";
import { effectEntry } from "@zotlit/plugin-kernel/vite";

export default defineConfig({
  plugins: [
    effectEntry("renderer", {
      vitest: true,
      scopes: [fileURLToPath(new URL("./src/", import.meta.url))],
    }),
  ],
  test: {
    ...testDefaults,
    include: ["src/**/*.test.ts"],
    environment: "node",
    clearMocks: true,
  },
});
