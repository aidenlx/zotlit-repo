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

// Each layer of the Query Views has one home and one boundary, by what a file
// needs from its host. `core/` is host-free: no Node built-in, `obsidian` or
// `electron`, so any host loads it; the Query File model and the plan of a
// view live here. `obsidian/` loads on Obsidian Mobile: the Obsidian API and
// kit, and no Node or Electron. `desktop/` alone reads Node and Electron: the
// Item Query adapter and its CLI, which read the database and write files, and
// the views that draw the annotation cards and open Attachments. A layer
// imports the layers below it only: core <- obsidian <- desktop.

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
const SERVICES = ["src/*/item-query/**"];

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
    {
      // Logging backlog: rework the file to log through Effect, then remove it from the list.
      files: [
        "src/desktop/annot-view/view.tsx",
        "src/desktop/query-view/view.tsx",
      ],
      rules: { "zotlit-logging/no-logtape-in-effect-file": "off" },
    },
    // Capability backlog: files that import Effect and still reach the App.
    // A file moves off its list when it takes Obsidian from the capability
    // tags.
    {
      // Obsidian views and components, which register on their own lifecycle.
      // A file moves off the list when its view reads the tags.
      files: ["src/desktop/annot-view/view.tsx"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // No tag member yet: `metadataCache.getCache`. The file also calls
      // `metadataCache.getFirstLinkpathDest` (the MetadataCache tag's
      // `firstLinkpathDest`) and `vault.getFileByPath`, which the Vault tag
      // has.
      files: ["src/desktop/query-view/table-notes.ts"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // The start-up hook hands Obsidian's workspace to the Annotation
      // Suggester and finds the active view for the Annotation History, as
      // the plugin entry did before the hook moved here.
      files: ["src/desktop/feature.ts"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // Default-runtime backlog: run the Effect through the bridge, a layer context runner or a runtime, then remove the file from the list.
      files: [
        "src/desktop/annot-view/view.tsx",
        "src/desktop/query-view/table-notes.ts",
        "src/desktop/query-view/view.tsx",
      ],
      rules: { "zotlit-services/no-default-runtime": "off" },
    },
    {
      // Clock backlog: read time through Clock (`Clock.currentTimeMillis` or `DateTime.now` in Effect code; `instantClock(yield* Clock.Clock)` from `@/lib/effect-clock` for a non-Effect core), then remove the file from the list.
      files: [
        "src/desktop/item-query/answer.ts",
        "src/desktop/item-query/job.ts",
        "src/desktop/item-query/measure.ts",
        "src/desktop/item-query/trace.ts",
      ],
      rules: { "zotlit-services/clock-time": "off" },
    },
    {
      // Legacy emitters, written before no-nanoevents. A file moves off this
      // list when its service converts to Effect.
      files: ["src/desktop/query-view/table-notes.ts"],
      rules: { "zotlit-services/no-nanoevents": "off" },
    },
    {
      files: ["src/*/annot-view/*.{ts,tsx}"],
      excludeFiles: ["**/*.test.{ts,tsx}"],
      rules: { "zotlit-design/annotation-view": "error" },
    },
    {
      // Guarded private API reaches its surface through obsidian-ex.d.ts.
      files: ["src/obsidian/query-view/obsidian-private/**"],
      rules: { "zotlit-private/no-unknown-cast": "error" },
    },
    {
      // A test's fake App stands in for the whole surface.
      files: ["src/obsidian/query-view/obsidian-private/*.test.ts"],
      rules: { "zotlit-private/no-unknown-cast": "off" },
    },
    {
      // Code written before the rule; new code follows it, and a file moves
      // off this list when it is next reworked.
      files: [
        "src/desktop/query-view/sort-control.tsx",
        "src/desktop/query-view/table-layout.tsx",
      ],
      rules: { "zotlit-css/no-obsidian-class": "off" },
    },
    {
      // Background work that stands in no window, which lives as long as the
      // plugin and so as the main window.
      files: ["src/desktop/item-query/measure.ts"],
      rules: { "zotlit-obsidian/no-global-timer": "off" },
    },
    ...testBaselineOverrides("packages/query-views"),
  ],
});
