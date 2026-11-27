import { defineConfig } from "oxlint";

import baseConfig from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  overrides: [
    {
      files: ["src/session.ts"],
      rules: { "max-params": "off" },
    },
    {
      files: ["src/sqlite-wasm.ts"],
      rules: { "typescript/no-implied-eval": "off" },
    },
  ],
});
