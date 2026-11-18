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

// Each layer of ZoteroReads has one home and one boundary. The contract and
// the Worker's handlers are host-free: no Node built-in, `obsidian` or
// `electron`, as in an engine package. The client loads on Obsidian Mobile:
// the Obsidian kit, and no Node or Electron. The desktop host alone reads
// Node and the desktop layer. A layer imports the layers below it only:
// contract <- worker, client <- desktop.

/** The plugin layers above the host-free base. */
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
      // The desktop host: Node, Electron and the desktop layer.
      files: ["src/desktop/**"],
      rules: {
        "no-restricted-imports": ["error", runtimeImports],
        "import/no-nodejs-modules": "off",
      },
    },
    {
      // Test support serves the tests of every layer, over Node SQLite.
      files: ["src/__fixtures__/**"],
      rules: { "no-restricted-imports": ["error", pluginTestImports] },
    },
    ...pluginCodeOverrides({ testImports: pluginTestImports }),
    engineNodeOnlyOverride(["src/__fixtures__/**"]),
    {
      // These adapters own effect/rpc worker creation, shutdown and log
      // transport.
      files: [
        "src/worker/serve.ts",
        "src/worker/worker-launch.ts",
        "src/client/worker-host.ts",
      ],
      rules: { "zotlit-services/worker-rpc": "off" },
    },
    {
      // Worker migration backlog: move snapshot integrity checks to effect/rpc,
      // then remove this file from the list.
      files: ["src/desktop/snapshot-integrity.ts"],
      rules: { "zotlit-services/worker-rpc": "off" },
    },
    {
      // @zotlit/db rows carry Temporal.Instant, the date type of the template
      // contract, and instant-codec.ts codes it for the ZoteroReads wire.
      files: ["src/contract/instant-codec.ts"],
      rules: { "zotlit-services/temporal-in-effect": "off" },
    },
    {
      // Clock backlog: read time through Clock (`Clock.currentTimeMillis` or `DateTime.now` in Effect code; `instantClock(yield* Clock.Clock)` from `@zotlit/plugin-kernel/effect-clock.ts` for a non-Effect core), then remove the file from the list.
      files: ["src/worker/citekey-snapshot.ts"],
      rules: { "zotlit-services/clock-time": "off" },
    },
    {
      // Effect tests written before the rule, in plain Vitest. A file moves
      // off this list when its cases move to it.effect.
      files: [
        "src/worker/citation-lookup.test.ts",
        "src/worker/connection.test.ts",
        "src/desktop/source.test.ts",
      ],
      rules: { "zotlit-effect-tests/no-effect-run-in-test": "off" },
    },
    ...testBaselineOverrides("packages/zotero-reads"),
  ],
});
