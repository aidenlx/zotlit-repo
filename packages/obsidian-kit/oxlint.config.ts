import { defineConfig } from "oxlint";

import baseConfig, {
  datePattern,
  itemQuerySchemaPaths,
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
    {
      files: ["src/obsidian-*.ts"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      files: ["src/components/obsidian/**"],
      rules: { "zotlit-css/no-obsidian-class": "off" },
    },
    {
      files: ["src/hover-popover.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [datePattern],
            paths: itemQuerySchemaPaths,
          },
        ],
      },
    },
    {
      files: ["vitest.setup.js"],
      rules: { "zotlit-obsidian/no-cross-window-instanceof": "off" },
    },
    {
      files: ["src/disposables.ts"],
      rules: { "zotlit-obsidian/no-global-timer": "off" },
    },
    ...testBaselineOverrides("packages/obsidian-kit"),
  ],
});
