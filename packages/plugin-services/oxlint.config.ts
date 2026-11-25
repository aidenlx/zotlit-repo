import { defineConfig } from "oxlint";

import baseConfig, {
  nodeGlobals,
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
    ...pluginCodeOverrides({
      testImports: pluginTestImports,
      services: ["src/**"],
    }),
    {
      files: [
        "src/core/note-index/frontmatter-date.ts",
        "src/core/note-index/frontmatter-date.test.ts",
      ],
      rules: {
        "effecttsgo/global-date": "off",
        "no-restricted-globals": ["error", nodeGlobals],
      },
    },
    {
      files: ["src/obsidian/setting-tab/effect-tab.ts"],
      rules: { "zotlit-services/scoped-runner": "off" },
    },
    ...testBaselineOverrides("packages/plugin-services"),
  ],
});
