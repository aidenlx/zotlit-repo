import { defineConfig } from "oxlint";

import baseConfig, {
  engineNodeOnlyOverride,
  parentImportPattern,
} from "@zotlit/config/oxlint";

const contractOnly =
  "The reader contract crosses between two plugins: it takes Obsidian types only, so no Effect, Node, Zotero or ZotLit value reaches the other side.";

export default defineConfig({
  extends: [baseConfig],
  rules: {
    "import/no-nodejs-modules": "error",
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          parentImportPattern,
          { group: ["*", "!obsidian", "!./*.ts"], message: contractOnly },
        ],
        paths: [
          { name: "obsidian", allowTypeImports: true, message: contractOnly },
        ],
      },
    ],
  },
  overrides: [
    engineNodeOnlyOverride(),
    {
      files: ["src/**/*.test.ts", "*.config.ts"],
      rules: {
        "no-restricted-imports": ["error", { patterns: [parentImportPattern] }],
      },
    },
  ],
});
