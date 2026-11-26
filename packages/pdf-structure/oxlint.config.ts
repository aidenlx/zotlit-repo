import { defineConfig } from "oxlint";

import baseConfig, { nodeAllowed } from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: [
    new URL("../config/oxlint-plugin-logging.ts", import.meta.url).pathname,
  ],
  overrides: [
    nodeAllowed(["oracle/**"]),
    {
      files: ["src/**"],
      rules: { "zotlit-logging/effect-logging-only": "error" },
    },
  ],
  ignorePatterns: ["src/vendor/*.js"],
});
