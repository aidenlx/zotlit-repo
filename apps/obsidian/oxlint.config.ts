import { defineConfig } from "oxlint";

import baseConfig, {
  datePattern,
  testBaselineOverrides,
} from "@zotlit/config/oxlint";
import {
  pluginCodeJsPlugins,
  pluginCodeOverrides,
  pluginCodeRules,
  pluginTestImports,
  runtimeImports,
} from "@zotlit/config/oxlint-plugin-code";

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: pluginCodeJsPlugins,
  rules: pluginCodeRules(runtimeImports),
  overrides: [
    ...pluginCodeOverrides({ testImports: pluginTestImports }),
    ...testBaselineOverrides("apps/obsidian"),
    {
      files: ["vite.config.ts"],
      rules: {
        "effecttsgo/global-console": "off",
        "effecttsgo/global-console-in-effect": "off",
      },
    },
    {
      files: ["src/lint/*.test.ts"],
      rules: {
        "no-restricted-imports": ["error", { patterns: [datePattern] }],
      },
    },
    {
      files: ["src/services/zotero-reads/item-query.test.ts"],
      rules: { "zotlit-effect-tests/no-effect-run-in-test": "off" },
    },
    {
      files: ["scripts/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              datePattern,
              {
                group: ["../src/**"],
                allowTypeImports: true,
                message:
                  "Scripts stay independent of plugin code; a check of plugin code is a Vitest test under src/.",
              },
            ],
          },
        ],
      },
    },
  ],
});
