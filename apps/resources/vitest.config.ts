import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

export default defineConfig({
  test: {
    ...testDefaults,
    include: ["scripts/**/*.test.ts"],
    environment: "node",
  },
});
