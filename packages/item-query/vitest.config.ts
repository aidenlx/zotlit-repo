import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    ...testDefaults,
    environment: "node",
    projects: [
      {
        extends: true,
        test: { name: "highest", include: ["src/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "lowest",
          include: [
            "src/query-items.test.ts",
            "src/query-annotations.test.ts",
            "src/query-attachments.test.ts",
            "src/query-relations.test.ts",
            "src/parity.test.ts",
          ],
          env: { ZOTLIT_SCENARIO_LAYOUT: "lowest" },
        },
      },
    ],
  },
});
