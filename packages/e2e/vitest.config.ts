import { join } from "node:path";
import { defineConfig } from "vitest/config";

import { pageTransform } from "./page-transform.ts";
import { e2eResultsDir } from "./src/results-dir.ts";

export default defineConfig({
  oxc: pageTransform,
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globalSetup: ["./src/container-obsidian.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "desktop",
          include: ["src/**/*.e2e.ts"],
          exclude: ["src/paired-run.e2e.ts"],
          globalSetup: ["./src/desktop-slot-setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "paired",
          include: ["src/paired-run.e2e.ts"],
          globalSetup: ["./src/desktop-slot-setup.ts", "./src/paired-setup.ts"],
        },
      },
    ],
    reporters: ["./src/reporter.ts", "json"],
    outputFile: { json: join(e2eResultsDir(), "results.json") },
    environment: "node",
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
