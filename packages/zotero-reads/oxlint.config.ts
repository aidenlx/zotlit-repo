import { defineConfig } from "oxlint";

import baseConfig, { testBaselineOverrides } from "@zotlit/config/oxlint";
import {
  pluginCodeJsPlugins,
  pluginCodeOverrides,
  pluginCodeRules,
  pluginTestImports,
  runtimeImports,
  withPatterns,
} from "@zotlit/config/oxlint-plugin-code";

const workerLayer = (message: string) => ({
  group: ["#worker/**"],
  message,
});
const contractImports = withPatterns(runtimeImports, [
  workerLayer(
    "The contract is the bottom layer of ZoteroReads; move the shared type here, or take the value as a parameter.",
  ),
]);
const clientImports = withPatterns(runtimeImports, [
  workerLayer(
    "The client imports the contract only; the host passes its capabilities in.",
  ),
]);

const NOT_TESTS = [
  "src/**/*.test.ts",
  "src/**/__fixtures__/**",
  "src/**/__fixtures__.ts",
];

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: pluginCodeJsPlugins,
  rules: pluginCodeRules(runtimeImports),
  overrides: [
    {
      files: ["src/contract/**"],
      excludeFiles: NOT_TESTS,
      rules: { "no-restricted-imports": ["error", contractImports] },
    },
    {
      files: ["src/client/**"],
      excludeFiles: NOT_TESTS,
      rules: { "no-restricted-imports": ["error", clientImports] },
    },
    {
      files: ["src/__fixtures__/**"],
      rules: { "no-restricted-imports": ["error", pluginTestImports] },
    },
    ...pluginCodeOverrides({ testImports: pluginTestImports }),
    {
      files: [
        "src/worker/serve.ts",
        "src/worker/worker-launch.ts",
        "src/client/worker-host.ts",
      ],
      rules: { "zotlit-services/worker-rpc": "off" },
    },
    {
      files: ["src/worker/snapshot/export.ts"],
      rules: { "zotlit-services/no-default-runtime": "off" },
    },
    {
      files: ["src/contract/instant-codec.ts"],
      rules: { "zotlit-services/temporal-in-effect": "off" },
    },
    ...testBaselineOverrides("packages/zotero-reads"),
  ],
});
