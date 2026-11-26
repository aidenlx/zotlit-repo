import { defineConfig } from "oxlint";

import baseConfig, { testBaselineOverrides } from "@zotlit/config/oxlint";
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
    ...pluginCodeOverrides({
      testImports: pluginTestImports,
      services: ["src/**"],
    }),
    {
      files: ["src/obsidian/lifecycle.ts"],
      rules: { "zotlit-obsidian/no-global-timer": "off" },
    },
    ...testBaselineOverrides("packages/plugin-shell"),
  ],
});
