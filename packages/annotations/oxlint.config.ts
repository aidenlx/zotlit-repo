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
      files: ["src/*/annot-view/**"],
      rules: { "zotlit-obsidian/no-global-timer": "error" },
    },
    {
      files: ["src/*/annot-view/*.{ts,tsx}"],
      excludeFiles: ["**/*.test.{ts,tsx}"],
      rules: { "zotlit-design/annotation-view": "error" },
    },
    indexedDbYield("src/obsidian/excerpt-image/store.ts", obsidianImports),
    indexedDbYield(
      "src/obsidian/excerpt-image/store.browser-test.ts",
      runtimeImports,
    ),
    ...testBaselineOverrides("packages/annotations"),
  ],
});
