import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    ...testDefaults,
    globalSetup: [
      ...testDefaults.globalSetup,
      "./scripts/message-types-setup.ts",
    ],
    // `include` lives on the projects: Vite merges a root `include` into each
    // project's own, which would widen every project back to everything.
    environment: "node",
    projects: [
      {
        extends: true,
        test: { name: "core", include: ["src/**/*.test.ts"] },
      },
      {
        // Obsidian runs the tree on Preact, so the UI suite runs with React
        // aliased the way the plugin's build aliases it.
        extends: true,
        resolve: {
          alias: {
            react: "preact/compat",
            "react-dom": "preact/compat",
            "@testing-library/react": "@testing-library/preact",
          },
        },
        test: {
          name: "ui",
          include: ["src/ui/**/*.test.tsx"],
          environment: "happy-dom",
          server: {
            deps: {
              // Run through Vite so its `react` import lands on the alias.
              inline: ["@effect/atom-react"],
            },
          },
        },
      },
    ],
  },
});
