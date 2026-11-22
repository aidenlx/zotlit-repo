import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

import { pageTransform } from "./page-transform.ts";

export default defineConfig({
  oxc: pageTransform,
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: testDefaults.globalSetup,
    environment: "node",
  },
});
