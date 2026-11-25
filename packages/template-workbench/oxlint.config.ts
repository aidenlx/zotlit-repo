import { defineConfig } from "oxlint";

import baseConfig, { testBaselineOverrides } from "@zotlit/config/oxlint";
import {
  pluginCodeJsPlugins,
  pluginCodeOverrides,
  pluginCodeRules,
  pluginTestImports,
  runtimeImports,
} from "@zotlit/config/oxlint-plugin-code";

const SERVICES = ["src/*/cli/**", "src/desktop/view/customize.ts"];

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: [...pluginCodeJsPlugins, "./src/core/lint/oxlint-plugin.ts"],
  rules: {
    ...pluginCodeRules(runtimeImports),
    "zotlit-workbench/no-controller-source-slice": "error",
  },
  overrides: [
    ...pluginCodeOverrides({
      testImports: pluginTestImports,
      services: SERVICES,
    }),
    {
      files: ["src/desktop/view/preview/markdown.tsx"],
      rules: { "zotlit-css/no-obsidian-class": "off" },
    },
    {
      files: [
        "src/obsidian/workbench-ui/match.chips.tsx",
        "src/obsidian/workbench-ui/property-list.tsx",
      ],
      rules: { "zotlit-css/no-obsidian-class": "off" },
    },
    {
      files: ["src/obsidian/editor/host.test.ts"],
      rules: { "zotlit-tests/no-class-assertion": "off" },
    },
    {
      files: ["**/*.test.{ts,tsx}"],
      rules: { "zotlit-workbench/no-controller-source-slice": "off" },
    },
    ...testBaselineOverrides("packages/template-workbench"),
  ],
});
