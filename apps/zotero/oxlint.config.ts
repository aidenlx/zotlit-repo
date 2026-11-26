import { defineConfig } from "oxlint";

import { testBaselineOverrides } from "@zotlit/config/oxlint";
import baseConfig, { nodeGlobalNames } from "@zotlit/config/oxlint";

const companionNodeFix =
  "The Companion runs in Zotero, where Node is absent. Take the value from the Zotero API or a parameter.";

const companionNodeGlobals = {
  globals: nodeGlobalNames.map((name) => ({
    name,
    message: companionNodeFix,
  })),
  checkGlobalObject: true,
};

export default defineConfig({
  extends: [baseConfig],
  rules: {
    "zotlit-runtime/no-node-builtin": ["error", { message: companionNodeFix }],
    "no-restricted-properties": [
      "error",
      {
        object: "Zotero",
        property: "Prefs",
        message:
          "Use the typed `prefs` wrapper in src/prefs/index.ts, which passes the required global:true flag. Raw Zotero.Prefs targets the wrong extensions.zotero.* branch.",
      },
    ],
  },
  overrides: [
    ...testBaselineOverrides("apps/zotero"),
    {
      files: ["src/**"],
      rules: {
        "effecttsgo/global-date": "off",
        "effecttsgo/global-date-in-effect": "off",
        "no-restricted-globals": ["error", companionNodeGlobals],
        "typescript/no-restricted-types": "off",
      },
    },
    {
      files: ["src/**/*.test.ts"],
      rules: { "no-restricted-globals": "off" },
    },
    {
      files: ["src/prefs/index.ts"],
      rules: {
        "no-restricted-properties": "off",
      },
    },
  ],
});
