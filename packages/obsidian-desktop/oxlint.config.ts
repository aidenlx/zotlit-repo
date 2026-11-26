import { defineConfig } from "oxlint";

import baseConfig, {
  nodeAllowed,
  testBaselineOverrides,
  withoutFileSystemAdapter,
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
  rules: pluginCodeRules(withoutFileSystemAdapter(runtimeImports)),
  overrides: [
    nodeAllowed(["**/*"]),
    ...pluginCodeOverrides({ testImports: pluginTestImports }),
    ...testBaselineOverrides("packages/obsidian-desktop"),
  ],
});
