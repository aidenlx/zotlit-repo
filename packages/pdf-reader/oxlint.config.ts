import { defineConfig } from "oxlint";

import baseConfig, {
  datePattern,
  itemQuerySchemaPaths,
  parentImportPattern,
  uniqueIdPaths,
} from "@zotlit/config/oxlint";

const hostAgnostic =
  "The reader core is host-agnostic: it imports no Obsidian layer and no ZotLit domain package. Reach the host through ReaderHost.";

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: [
    new URL("../config/oxlint-plugin-obsidian-css.ts", import.meta.url)
      .pathname,
  ],
  overrides: [
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
                  "obsidian",
                  "obsidian/**",
                  "../obsidian",
                  "../obsidian/**",
                  "#/obsidian/**",
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
