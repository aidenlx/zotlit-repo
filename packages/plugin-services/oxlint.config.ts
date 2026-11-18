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

// Each layer of the platform services has one home and one boundary, by what
// a file needs from its host. `core/` is host-free: no Node built-in,
// `obsidian` or `electron`, so a Web Worker or any host loads it.
// `obsidian/` loads on Obsidian Mobile: the Obsidian API and kit, and no Node
// or Electron. `desktop/` alone reads Node and Electron. A layer imports the
// layers below it only: core <- obsidian <- desktop.

/** The plugin layers above the host-free base. */
const pluginLayers = {
  group: [
    "@zotlit/obsidian-kit",
    "@zotlit/obsidian-kit/**",
    "@zotlit/obsidian-desktop",
    "@zotlit/obsidian-desktop/**",
    "@zotlit/zotero-reads/client/**",
    "@zotlit/zotero-reads/desktop/**",
  ],
  message:
    "The host-free layer runs on every host and in a Web Worker; take the host capability as a value or a service tag, or move the file to src/obsidian/.",
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
    "@zotlit/zotero-reads/desktop/**",
  ],
  message:
    "The Obsidian layer loads on Obsidian Mobile, where Node and Electron are absent; desktop code belongs in src/desktop/.",
};
const layer = (names: string[], message: string) => ({
  group: names.map((name) => `#${name}/**`),
  message,
});
const aboveCore = layer(
  ["obsidian", "desktop", "__fixtures__"],
  "The host-free layer is the bottom layer; move the shared type here, or take the value as a parameter.",
);
const aboveObsidian = layer(
  ["desktop", "__fixtures__"],
  "The Obsidian layer imports the host-free layer only; the desktop host passes its capabilities in.",
);

const coreImports = withPatterns(runtimeImports, [
  hostModulePattern,
  pluginLayers,
  aboveCore,
]);
const obsidianImports = withPatterns(runtimeImports, [
  desktopModules,
  aboveObsidian,
]);

const NOT_TESTS = [
  "src/**/*.test.ts",
  "src/**/*.bench.ts",
  "src/**/__fixtures__/**",
  "src/**/__fixtures__.ts",
  "src/**/test-utils.ts",
  "src/**/test-clock.ts",
];

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: pluginCodeJsPlugins,
  rules: {
    ...pluginCodeRules(runtimeImports),
    "import/no-nodejs-modules": "error",
  },
  overrides: [
    {
      files: ["src/core/**"],
      excludeFiles: NOT_TESTS,
      rules: { "no-restricted-imports": ["error", coreImports] },
    },
    {
      files: ["src/obsidian/**"],
      excludeFiles: NOT_TESTS,
      rules: { "no-restricted-imports": ["error", obsidianImports] },
    },
    {
      // The desktop host: Node and Electron.
      files: ["src/desktop/**"],
      rules: { "import/no-nodejs-modules": "off" },
    },
    ...pluginCodeOverrides({
      testImports: pluginTestImports,
      services: ["src/**"],
    }),
    engineNodeOnlyOverride([
      "src/**/__fixtures__/**",
      "src/**/__fixtures__.ts",
      "src/**/test-utils.ts",
    ]),
    {
      // The sink owners may use LogTape directly.
      files: ["src/obsidian/log/**"],
      rules: {
        "zotlit-logging/no-logtape-in-effect-file": "off",
        "effecttsgo/global-console": "off",
        "effecttsgo/global-console-in-effect": "off",
      },
    },
    {
      // Capability backlog: no tag member yet for `vault.adapter`. The file
      // moves off the list when it takes Obsidian from the capability tags.
      files: ["src/obsidian/log/service.ts"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // Date adapter: Obsidian's YAML frontmatter can hand in a Date.
      files: [
        "src/core/note-index/frontmatter-date.ts",
        "src/core/note-index/frontmatter-date.test.ts",
      ],
      rules: {
        "effecttsgo/global-date": "off",
        "no-restricted-globals": "off",
      },
    },
    {
      // Background work that stands in no window, which lives as long as the
      // plugin and so as the main window.
      files: ["src/obsidian/log/vault-sink.ts"],
      rules: { "zotlit-obsidian/no-global-timer": "off" },
    },
    ...testBaselineOverrides("packages/plugin-services"),
  ],
});
