import { defineConfig } from "oxlint";

import baseConfig from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  plugins: ["node"],
  ignorePatterns: ["zotero-client/**"],
});
