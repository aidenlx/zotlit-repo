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

// The kernel is host-free: no Node built-in, `obsidian` or `electron`, as in
// an engine package, and none of the layers above it.
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
      // These tests exercise the run entry points themselves.
      files: ["src/effect-runtime.test.ts", "src/effect-entry.test.ts"],
      rules: { "zotlit-effect-tests/no-effect-run-in-test": "off" },
    },
    {
      // The helper the rule points at.
      files: ["src/effect-scope.ts"],
      rules: { "zotlit-services/scope-closed": "off" },
    },
    {
      // The bridge and the test entry point build the runners the rule
      // points at.
      files: ["src/effect-bridge.ts", "src/effect-vitest.ts"],
      rules: { "zotlit-services/no-default-runtime": "off" },
    },
    {
      // Default-runtime backlog: run the Effect through the bridge, a layer context runner or a runtime, then remove the file from the list.
      files: ["src/effect-scope.ts"],
      rules: { "zotlit-services/no-default-runtime": "off" },
    },
    {
      // Converts the Effect Clock into a Temporal function for a non-Effect core.
      files: ["src/effect-clock.ts"],
      rules: { "zotlit-services/clock-time": "off" },
    },
    {
      // Converts between Effect's DateTime and Clock and the Temporal of plain code.
      files: ["src/effect-clock.ts", "src/effect-clock.test.ts"],
      rules: { "zotlit-services/temporal-in-effect": "off" },
    },
    {
      // The wrappers, which reach the real package (NATIVE in
      // scripts/effect-entry.ts).
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
