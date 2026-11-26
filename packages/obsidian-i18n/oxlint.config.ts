import { defineConfig } from "oxlint";

import { testBaselineOverrides } from "@zotlit/config/oxlint";
import baseConfig, { nodeAllowed } from "@zotlit/config/oxlint";

export default defineConfig({
  overrides: [
    nodeAllowed(["bin.mjs", "src/*.ts"]),
    ...testBaselineOverrides("packages/obsidian-i18n"),
  ],
  extends: [baseConfig],
});
