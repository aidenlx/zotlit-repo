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
    include: ["src/docs-walks/**/*.walk.ts"],
    globalSetup: ["./src/docs-walks/docs-walk-setup.ts"],
    reporters: ["./src/reporter.ts", "json"],
    outputFile: { json: join(e2eResultsDir(), "results.json") },
    environment: "node",
    fileParallelism: false,
    bail: 1,
    testTimeout: 60000,
    hookTimeout: 300000,
  },
});
