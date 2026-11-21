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

// Each layer of the Template Workbench has one home and one boundary, by what a
// file needs from its host. `core/` is host-free: no Node built-in, `obsidian`
// or `electron`, so any host loads it. `obsidian/` loads on Obsidian Mobile:
// the Obsidian API and kit, and no Node or Electron; the Obsidian host of the
// Workbench UI lives here. `desktop/` alone reads Node and Electron: the
// Template Workbench CLI and the views over template data, which links files
// on disk. A layer imports the layers below it only: core <- obsidian <-
// desktop.

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

/** The files that hold Effect services; the others hold views. */
const SERVICES = ["src/*/cli/**", "src/desktop/view/customize.ts"];

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: [...pluginCodeJsPlugins, "./src/core/lint/oxlint-plugin.ts"],
  rules: {
    ...pluginCodeRules(runtimeImports),
    "zotlit-workbench/no-controller-source-slice": "error",
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
    // Capability backlog: files that import Effect and still reach the App.
    // A file moves off its list when it takes Obsidian from the capability
    // tags.
    {
      // Obsidian views and components, which register on their own lifecycle.
      // A file moves off the list when its view reads the tags.
      files: [
        "src/desktop/data-explorer/view.tsx",
        "src/desktop/view/view.tsx",
      ],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // Plain async code, or an Effect.fn, that reaches the App through
      // `deps.app`: the deps must carry the tag first.
      files: ["src/desktop/view/preview/render.ts"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // Default-runtime backlog: run the Effect through the bridge, a layer context runner or a runtime, then remove the file from the list.
      files: [
        "src/obsidian/view/preview/citations.ts",
        "src/obsidian/view/match-data.ts",
        "src/desktop/view/view.tsx",
      ],
      rules: { "zotlit-services/no-default-runtime": "off" },
    },
    {
      // A reading view of a note: the app's own classes draw its Properties
      // block, so the sheet reads as the note does in the editor.
      files: ["src/desktop/view/preview/markdown.tsx"],
      rules: { "zotlit-css/no-obsidian-class": "off" },
    },
    {
      // Code written before the rule; new code follows it, and a file moves
      // off this list when it is next reworked.
      files: ["src/obsidian/editor/theme.tsx"],
      rules: { "zotlit-css/no-obsidian-class": "off" },
    },
    {
      // Effect tests written before the rule, in plain Vitest. A file moves
      // off this list when its cases move to it.effect.
      files: ["src/desktop/view/view.test.ts"],
      rules: { "zotlit-effect-tests/no-effect-run-in-test": "off" },
    },
    {
      // Tests written before the rule that assert zt: classes; a file moves off
      // this list when its assertions move to behavior.
      files: ["src/obsidian/editor/host.test.ts"],
      rules: { "zotlit-tests/no-class-assertion": "off" },
    },
    {
      // Tests read their own LF fixtures and set up state they then check.
      files: ["**/*.test.{ts,tsx}"],
      rules: { "zotlit-workbench/no-controller-source-slice": "off" },
    },
    ...testBaselineOverrides("packages/template-workbench"),
  ],
});
