import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

const UI_TESTS = ["src/**/*.test.tsx"];

export default defineConfig({
  test: {
    ...testDefaults,
    environment: "happy-dom",
    projects: [
      {
        extends: true,
        test: { name: "react", include: UI_TESTS },
      },
      {
        extends: true,
        resolve: {
          alias: {
            react: "preact/compat",
            "react-dom": "preact/compat",
            "@testing-library/react": "@testing-library/preact",
          },
        },
        test: { name: "preact", include: UI_TESTS },
      },
      {
        extends: true,
        test: { name: "unit", include: ["src/**/*.test.ts"] },
      },
    ],
  },
});
