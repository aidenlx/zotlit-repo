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
      // The rule tests reach the package-local Oxlint modules in scripts/.
      files: ["src/lint/*.test.ts"],
      rules: {
        "no-restricted-imports": ["error", { patterns: [datePattern] }],
      },
    },
    {
      // Effect tests written before the rule, in plain Vitest. A file moves
      // off this list when its cases move to it.effect.
      files: ["src/services/zotero-reads/item-query.test.ts"],
      rules: { "zotlit-effect-tests/no-effect-run-in-test": "off" },
    },
    {
      // Node runs these straight from source, where the `@/` alias does not
      // resolve; and they stay independent of plugin code, which
      // tsconfig.node.json cannot type-check.
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
