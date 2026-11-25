import { defineConfig } from "oxlint";

import baseConfig, { testBaselineOverrides } from "@zotlit/config/oxlint";
import {
  commonImports,
  pluginCodeJsPlugins,
  pluginCodeOverrides,
  pluginCodeRules,
  pluginTestImports,
  runtimeImports,
  withPatterns,
} from "@zotlit/config/oxlint-plugin-code";

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: pluginCodeJsPlugins,
  rules: pluginCodeRules(runtimeImports),
  overrides: [
    ...pluginCodeOverrides({
      testImports: withPatterns(pluginTestImports, [
        {
          group: ["@zotlit/db/client/node"],
          message:
            "The kernel is host-free, and its tests hold it to that; take the database client as a value.",
        },
      ]),
    }),
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
      files: ["src/worker/effect-log-port.ts"],
      rules: { "effecttsgo/global-console": "off" },
    },
    {
      files: ["src/worker/effect-clock.ts"],
      rules: { "zotlit-services/clock-time": "off" },
    },
    {
      files: ["src/worker/effect-clock.ts", "src/worker/effect-clock.test.ts"],
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
        "no-restricted-imports": ["error", commonImports],
      },
    },
    ...testBaselineOverrides("packages/plugin-kernel"),
  ],
});
