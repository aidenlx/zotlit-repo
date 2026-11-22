import { defineConfig } from "oxlint";

import baseConfig, {
  engineNodeOnlyOverride,
  hostModulePattern,
  testBaselineOverrides,
} from "@zotlit/config/oxlint";
import {
  commonImports,
  pluginCodeJsPlugins,
  pluginCodeOverrides,
  pluginCodeRules,
  pluginTestImports,
  runtimeImports,
  withPatterns,
} from "@zotlit/config/oxlint-plugin-code";

const layerPattern = {
  group: [
    "@zotlit/obsidian-kit",
    "@zotlit/obsidian-kit/**",
    "@zotlit/obsidian-desktop",
    "@zotlit/obsidian-desktop/**",
  ],
  message:
    "The kernel is the bottom layer of the plugin packages; move the code here, or take it as a value.",
};
const boundary = [hostModulePattern, layerPattern];
const imports = withPatterns(runtimeImports, boundary);

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: pluginCodeJsPlugins,
  rules: {
    ...pluginCodeRules(imports),
    "import/no-nodejs-modules": "error",
  },
  overrides: [
    ...pluginCodeOverrides({
      testImports: withPatterns(pluginTestImports, boundary),
    }),
    engineNodeOnlyOverride(),
    {
      files: ["src/effect-runtime.test.ts", "src/effect-entry.test.ts"],
      rules: { "zotlit-effect-tests/no-effect-run-in-test": "off" },
    },
    {
      files: ["src/effect-scope.ts"],
      rules: { "zotlit-services/scope-closed": "off" },
    },
    {
      files: ["src/effect-bridge.ts", "src/effect-vitest.ts"],
      rules: { "zotlit-services/no-default-runtime": "off" },
    },
    {
      files: ["src/effect-scope.ts"],
      rules: { "zotlit-services/no-default-runtime": "off" },
    },
    {
      files: ["src/effect-clock.ts"],
      rules: { "zotlit-services/clock-time": "off" },
    },
    {
      files: ["src/effect-clock.ts", "src/effect-clock.test.ts"],
      rules: { "zotlit-services/temporal-in-effect": "off" },
    },
    {
      files: [
        "src/browser-scheduler.ts",
        "src/effect.ts",
        "src/effect-layer.ts",
        "src/effect-log.ts",
        "src/effect-runtime.ts",
        "src/effect-runtime-factory.ts",
        "src/effect-services.ts",
        "src/effect-vitest.ts",
        "src/effect-worker.ts",
        "src/effect-worker-runtime.ts",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          withPatterns(commonImports, boundary),
        ],
      },
    },
    ...testBaselineOverrides("packages/plugin-kernel"),
  ],
});
