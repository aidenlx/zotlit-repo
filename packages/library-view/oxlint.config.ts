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

// Each layer of the Library View has one home and one boundary, by what a file
// needs from its host. `core/` is host-free: no Node built-in, `obsidian` or
// `electron`, so any host loads it. `obsidian/` loads on Obsidian Mobile: the
// Obsidian API and kit, and no Node or Electron; the Release check lives here.
// `desktop/` alone reads Node and Electron: the Library View and the Welcome
// View banner, which read the Query Views and the Zotero data folder, and the
// quick switcher, which opens Attachments. A layer imports the layers below it
// only: core <- obsidian <- desktop.

/** The plugin layers above the host-free base. */
const pluginLayers = {
  group: [
    "@zotlit/obsidian-kit",
    "@zotlit/obsidian-kit/**",
    "@zotlit/obsidian-desktop",
    "@zotlit/obsidian-desktop/**",
    "@zotlit/zotero-reads/client/**",
    "@zotlit/zotero-reads/desktop/**",
    "@zotlit/plugin-services/obsidian/**",
    "@zotlit/plugin-services/desktop/**",
    "@zotlit/annotations/obsidian/**",
    "@zotlit/annotations/desktop/**",
    "@zotlit/citations/obsidian/**",
    "@zotlit/citations/desktop/**",
    "@zotlit/notes/obsidian/**",
    "@zotlit/notes/desktop/**",
    "@zotlit/template-workbench/obsidian/**",
    "@zotlit/template-workbench/desktop/**",
    "@zotlit/query-views/obsidian/**",
    "@zotlit/query-views/desktop/**",
  ],
  message:
    "The host-free layer runs on every host; take the host capability as a value or a service tag, or move the file to src/obsidian/.",
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
    "@zotlit/plugin-services/desktop/**",
    "@zotlit/annotations/desktop/**",
    "@zotlit/citations/desktop/**",
    "@zotlit/notes/desktop/**",
    "@zotlit/template-workbench/desktop/**",
    "@zotlit/query-views/desktop/**",
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
const aboveDesktop = layer(
  ["__fixtures__"],
  "Test support stays out of the plugin's code.",
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
const desktopImports = withPatterns(runtimeImports, [aboveDesktop]);

const NOT_TESTS = [
  "src/**/*.test.ts",
  "src/**/*.browser-test.ts",
  "src/**/__fixtures__/**",
];

/** The folders that hold Effect services; the others hold views. */
const SERVICES = ["src/*/release/**"];

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
      excludeFiles: NOT_TESTS,
      rules: {
        "no-restricted-imports": ["error", desktopImports],
        "import/no-nodejs-modules": "off",
      },
    },
    ...pluginCodeOverrides({
      testImports: pluginTestImports,
      services: SERVICES,
    }),
    engineNodeOnlyOverride(["src/__fixtures__/**"]),
    // Capability backlog: files that import Effect and still reach the App,
    // grouped by what blocks the change. A file moves off its list when it
    // takes Obsidian from the capability tags.
    {
      // Obsidian views and components, which register on their own lifecycle.
      // A file moves off the list when its view reads the tags.
      files: ["src/desktop/welcome/banner.tsx"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // No tag member yet: the side splits (library/view.ts), and the raw
      // workspace that the editor lookup takes (library/view.ts,
      // library/item-actions.ts).
      files: [
        "src/desktop/library/item-actions.ts",
        "src/desktop/library/view.ts",
      ],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // Listens to the workspace's `layout-change` on the App; the Workspace
      // tag's `changes` now carries it.
      files: ["src/desktop/library/welcome-register.ts"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // Default-runtime backlog: run the Effect through the bridge, a layer context runner or a runtime, then remove the file from the list.
      files: [
        "src/desktop/library/item-actions.ts",
        "src/desktop/library/library-tree.tsx",
        "src/desktop/library/view.ts",
        "src/desktop/welcome/connection.ts",
      ],
      rules: { "zotlit-services/no-default-runtime": "off" },
    },
    {
      // Legacy emitters, written before no-nanoevents. A file moves off this
      // list when its service converts to Effect.
      files: [
        "src/desktop/library/item-drag.test.ts",
        "src/desktop/library/view.test.ts",
      ],
      rules: { "zotlit-services/no-nanoevents": "off" },
    },
    {
      // Tests written before the rule that assert zt: classes; a file moves off
      // this list when its assertions move to behavior.
      files: ["src/desktop/welcome/Welcome.test.ts"],
      rules: { "zotlit-tests/no-class-assertion": "off" },
    },
    ...testBaselineOverrides("packages/library-view"),
  ],
});
