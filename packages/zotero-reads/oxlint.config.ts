import { defineConfig } from "oxlint";

import baseConfig, {
  engineNodeOnlyOverride,
  hostModulePattern,
  testBaselineOverrides,
} from "@zotlit/config/oxlint";
import {
  pluginCodeJsPlugins,
  pluginCodeOverrides,
  pluginCodeRules,
  pluginTestImports,
  runtimeImports,
  withPatterns,
} from "@zotlit/config/oxlint-plugin-code";

const pluginLayers = {
  group: [
    "@zotlit/obsidian-kit",
    "@zotlit/obsidian-kit/**",
    "@zotlit/obsidian-desktop",
    "@zotlit/obsidian-desktop/**",
  ],
  message:
    "The contract and the Worker's handlers run on every host; take the host capability as a value or a service tag.",
};
const desktopModules = {
  group: [
    "electron",
    "electron/**",
    "@electron/remote",
    "@electron/remote/**",
    "@zotlit/db/client/node",
    "@zotlit/obsidian-desktop",
    "@zotlit/obsidian-desktop/**",
  ],
  message:
    "The client loads on Obsidian Mobile, where Node and Electron are absent; desktop code belongs in src/desktop/.",
};
const layer = (names: string[], message: string) => ({
  group: names.map((name) => `#${name}/**`),
  message,
});
const aboveContract = layer(
  ["worker", "client", "desktop", "__fixtures__"],
  "The contract is the bottom layer of ZoteroReads; move the shared type here, or take the value as a parameter.",
);
const aboveWorker = layer(
  ["client", "desktop", "__fixtures__"],
  "The Worker's handlers import the contract only; the host passes its capabilities in.",
);
const aboveClient = layer(
  ["worker", "desktop", "__fixtures__"],
  "The client imports the contract only; the host passes its capabilities in.",
);

const hostFree = withPatterns(runtimeImports, [
  hostModulePattern,
  pluginLayers,
]);
const contractImports = withPatterns(hostFree, [aboveContract]);
const workerImports = withPatterns(hostFree, [aboveWorker]);
const clientImports = withPatterns(runtimeImports, [
  desktopModules,
  aboveClient,
]);

const NOT_TESTS = [
  "src/**/*.test.ts",
  "src/**/__fixtures__/**",
  "src/**/__fixtures__.ts",
];

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: pluginCodeJsPlugins,
  rules: {
    ...pluginCodeRules(hostFree),
    "import/no-nodejs-modules": "error",
  },
  overrides: [
    {
      files: ["src/contract/**"],
      excludeFiles: NOT_TESTS,
      rules: { "no-restricted-imports": ["error", contractImports] },
    },
    {
      files: ["src/worker/**"],
      excludeFiles: NOT_TESTS,
      rules: { "no-restricted-imports": ["error", workerImports] },
    },
    {
      files: ["src/client/**"],
      excludeFiles: NOT_TESTS,
      rules: { "no-restricted-imports": ["error", clientImports] },
    },
    {
      files: ["src/desktop/**"],
      rules: {
        "no-restricted-imports": ["error", runtimeImports],
        "import/no-nodejs-modules": "off",
      },
    },
    {
      files: ["src/__fixtures__/**"],
      rules: { "no-restricted-imports": ["error", pluginTestImports] },
    },
    ...pluginCodeOverrides({ testImports: pluginTestImports }),
    engineNodeOnlyOverride(["src/__fixtures__/**"]),
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
      rules: {
        "import/no-nodejs-modules": "off",
        "zotlit-services/no-default-runtime": "off",
      },
    },
    {
      files: ["src/contract/instant-codec.ts"],
      rules: { "zotlit-services/temporal-in-effect": "off" },
    },
    ...testBaselineOverrides("packages/zotero-reads"),
  ],
});
