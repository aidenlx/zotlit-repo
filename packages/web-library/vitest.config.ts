import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

const require = createRequire(import.meta.url);
const sqliteWasmBrowserBuild = join(
  dirname(require.resolve("@sqlite.org/sqlite-wasm")),
  "index.mjs",
);

export default defineConfig({
  resolve: {
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
