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
    ...pluginCodeOverrides({ testImports: pluginTestImports }),
    ...testBaselineOverrides("apps/reader"),
    {
      files: ["vite.config.ts"],
      rules: {
        "effecttsgo/global-console": "off",
        "effecttsgo/global-console-in-effect": "off",
      },
    },
  ],
});
