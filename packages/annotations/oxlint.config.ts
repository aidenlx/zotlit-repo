import { defineConfig } from "oxlint";
import type { OxlintOverride } from "oxlint";

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
import type { RestrictedImports } from "@zotlit/config/oxlint-plugin-code";

// Each layer of the annotation feature has one home and one boundary, by what
// a file needs from its host. `core/` is host-free: no Node built-in,
// `obsidian` or `electron`, so any host loads it. `obsidian/` loads on
// Obsidian Mobile: the Obsidian API and kit, and no Node or Electron; the
// Annotation Repository and the annotation model live here. `desktop/` alone
// reads Node and Electron. A layer imports the layers below it only:
// core <- obsidian <- desktop.

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
  ],
  message:
    "The Obsidian layer loads on Obsidian Mobile, where Node and Electron are absent; desktop code belongs in src/desktop/.",
};
const readerModules = {
  group: [
    "@zotlit/pdf-reader",
    "@zotlit/pdf-reader/**",
    "@zotlit/pdfjs",
    "@zotlit/pdfjs/**",
  ],
  allowTypeImports: true,
  message:
    "ZotLit Reader owns the PDF reader and pdf.js; reach them through ReaderConnection and @zotlit/reader-api.",
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
  readerModules,
  aboveCore,
]);
const obsidianImports = withPatterns(runtimeImports, [
  desktopModules,
  readerModules,
  aboveObsidian,
]);
const desktopImports = withPatterns(runtimeImports, [
  readerModules,
  aboveDesktop,
]);

const NOT_TESTS = [
  "src/**/*.test.ts",
  "src/**/*.browser-test.ts",
  "src/**/__fixtures__/**",
];

/**
 * IndexedDB transactions must finish their request microtasks before a task
 * yield, so `file` may import the scheduler's yield guards.
 */
function indexedDbYield(
  file: string,
  imports: RestrictedImports,
): OxlintOverride {
  return {
    files: [file],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          ...imports,
          paths: imports.paths.map((path) =>
            path.name === "effect/Scheduler"
              ? {
                  ...path,
                  allowImportNames: [
                    "PreventSchedulerYield",
                    "MaxOpsBeforeYield",
                  ],
                }
              : path,
          ),
        },
      ],
    },
  };
}

/** The folders that hold Effect services; the Annotation View holds a view. */
const SERVICES = [
  "src/*/annotation-repository/**",
  "src/*/attachment-open/**",
  "src/*/excerpt-image/**",
  "src/*/pdf-annotation-editor/**",
  "src/*/reader-connection/**",
  "src/*/reader-session/**",
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
    engineNodeOnlyOverride(["src/__fixtures__/**", "src/**/*.browser-test.ts"]),
    {
      // UI code runs in the window it stands in, a pop-out included.
      files: ["src/*/annot-view/**"],
      rules: { "zotlit-obsidian/no-global-timer": "error" },
    },
    {
      files: ["src/*/annot-view/*.{ts,tsx}"],
      excludeFiles: ["**/*.test.{ts,tsx}"],
      rules: { "zotlit-design/annotation-view": "error" },
    },
    {
      // Legacy emitters, written before no-nanoevents. A file moves off this
      // list when its service converts to Effect.
      files: ["src/core/reader-session/session.ts"],
      rules: { "zotlit-services/no-nanoevents": "off" },
    },
    indexedDbYield("src/obsidian/excerpt-image/store.ts", obsidianImports),
    indexedDbYield(
      "src/obsidian/excerpt-image/store.browser-test.ts",
      runtimeImports,
    ),
    {
      // Code written before the rule; new code follows it, and a file moves
      // off this list when it is next reworked.
      files: [
        "src/desktop/annot-view/AnnotView.tsx",
        "src/obsidian/annot-view/FilterBar.tsx",
        "src/obsidian/annot-view/tag-editor.tsx",
      ],
      rules: { "zotlit-css/no-obsidian-class": "off" },
    },
    ...testBaselineOverrides("packages/annotations"),
  ],
});
