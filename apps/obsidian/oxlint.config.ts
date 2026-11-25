import { defineConfig } from "oxlint";

import baseConfig, {
  nodeFreeGlobals,
  nodeAllowed,
  nodeImportFix,
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
    nodeAllowed(["src/zt-body.ts"]),
    ...pluginCodeOverrides({ testImports: pluginTestImports }),
    ...testBaselineOverrides("apps/obsidian"),
    {
      files: ["src/__fixtures__/mobile-host/**"],
      excludeFiles: ["**/*.test.ts"],
      rules: {
        "no-restricted-globals": ["error", nodeFreeGlobals],
        "zotlit-runtime/no-node-builtin": ["error", { message: nodeImportFix }],
      },
    },
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
