import { defineConfig } from "oxlint";

import baseConfig, {
  nodeAllowed,
  datePattern,
  itemQuerySchemaPaths,
  parentImportPattern,
  uniqueIdPaths,
} from "@zotlit/config/oxlint";

const hostAgnostic =
  "The reader core imports no ZotLit domain package. Reach the host through ReaderHost.";

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: [
    new URL("../config/oxlint-plugin-obsidian-css.ts", import.meta.url)
      .pathname,
  ],
  overrides: [
    nodeAllowed(["build/**", "test/**"]),
    {
      files: ["src/core/**/*.tsx"],
      rules: {
        "zotlit-css/no-obsidian-class": "error",
        "zotlit-css/no-setting-in-react": "error",
      },
    },
    {
      files: ["src/core/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              parentImportPattern,
              datePattern,
              {
                group: [
                  "@zotlit/db",
                  "@zotlit/db/**",
                  "@zotlit/pdf-structure",
                  "@zotlit/pdf-structure/**",
                  "@zotlit/protocol",
                  "@zotlit/protocol/**",
                ],
                message: hostAgnostic,
              },
            ],
            paths: [...itemQuerySchemaPaths, ...uniqueIdPaths],
          },
        ],
      },
    },
  ],
});
