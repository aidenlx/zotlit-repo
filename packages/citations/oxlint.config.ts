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
    "@zotlit/annotations/obsidian/**",
    "@zotlit/annotations/desktop/**",
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

function withoutScanGuard(imports: RestrictedImports): RestrictedImports {
  return {
    ...imports,
    patterns: imports.patterns.filter(
      (pattern) =>
        !(pattern.group ?? []).some((group) =>
          group.endsWith("citation-index/scan.ts"),
        ),
    ),
  };
}

const NOT_TESTS = [
  "src/**/*.test.ts",
  "src/**/*.browser-test.ts",
  "src/**/__fixtures__/**",
];

const SERVICES = [
  "src/*/annotation-popover/**",
  "src/*/citation-index/**",
  "src/*/citation-parse/**",
  "src/*/citation-popover/**",
  "src/*/citation-text/**",
  "src/*/citekey-editor/**",
  "src/*/citekey-navigation/**",
  "src/*/citekey-reading/**",
  "src/*/graph-citations/**",
  "src/*/pandoc/**",
  "src/*/wikilink-editor/**",
  "src/*/wikilink-reading/**",
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
    {
      files: ["src/obsidian/citekey-editor/decorate.ts"],
      rules: {
        "no-restricted-imports": ["error", withoutScanGuard(obsidianImports)],
      },
    },
    ...pluginCodeOverrides({
      testImports: pluginTestImports,
      services: SERVICES,
    }),
    engineNodeOnlyOverride(["src/__fixtures__/**", "scripts/**"]),
    {
      files: ["src/core/citation-parse/worker-host.ts"],
      rules: { "zotlit-services/worker-rpc": "off" },
    },
    {
      files: ["src/core/pandoc/filter/zotlit-cite.pandoc.test.ts"],
      rules: {
        "effecttsgo/global-console": "off",
        "effecttsgo/global-console-in-effect": "off",
      },
    },
    {
      files: ["src/obsidian/references/copied-bibliography.ts"],
      rules: { "obsidianmd/no-static-styles-assignment": "off" },
    },
    ...testBaselineOverrides("packages/citations"),
  ],
});
