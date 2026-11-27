import { join } from "node:path";
import { defineConfig } from "vitest/config";

import { pageTransform } from "./page-transform.ts";
import { e2eResultsDir } from "./src/results-dir.ts";
import TimedSequencer from "./src/timed-sequencer.ts";

export default defineConfig({
  oxc: pageTransform,
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "desktop",
          include: ["src/**/*.e2e.ts"],
          exclude: ["src/paired-*.e2e.ts"],
          globalSetup: ["./src/container-obsidian.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "paired",
          include: ["src/paired-*.e2e.ts"],
          globalSetup: ["./src/container-obsidian.ts", "./src/paired-setup.ts"],
        },
      },
    ],
    setupFiles: ["./src/run-hold.ts"],
    reporters: ["./src/reporter.ts", "json"],
    outputFile: { json: join(e2eResultsDir(), "results.json") },
    environment: "node",
    fileParallelism: false,
    sequence: { sequencer: TimedSequencer },
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
