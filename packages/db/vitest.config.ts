import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

const driverRequire = createRequire(
  createRequire(import.meta.url).resolve("@zotlit/drizzle-sqlite-wasm"),
);
const sqliteWasmBrowserBuild = join(
  dirname(driverRequire.resolve("@sqlite.org/sqlite-wasm")),
  "index.mjs",
);

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: [
      {
        find: /^@sqlite\.org\/sqlite-wasm$/,
        replacement: sqliteWasmBrowserBuild,
      },
    ],
  },
  test: {
    ...testDefaults,
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
