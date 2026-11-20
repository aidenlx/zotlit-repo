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

// Each layer of the citations has one home and one boundary, by what a file
// needs from its host. `core/` is host-free: no Node built-in, `obsidian` or
// `electron`, so any host loads it. `obsidian/` loads on Obsidian Mobile: the
// Obsidian API and kit, and no Node or Electron; citation parsing, the Citation
// Index, the Document Citation Text and the Pandoc Engine live here.
// `desktop/` alone reads Node and Electron: the CSL styles on disk, Pandoc
// export and its processes. A layer imports the layers below it only:
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

/**
 * `imports` without the citation scan guard: the editor decoration scans the
 * open document itself, as the parse worker does.
 */
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

/** The folders that hold Effect services; the others hold views. */
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
      // The desktop host: Node and Electron.
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
      // These adapters own effect/rpc worker creation, shutdown and log transport.
      files: ["src/core/citation-parse/worker-host.ts"],
      rules: { "zotlit-services/worker-rpc": "off" },
    },
    // Capability backlog: files that import Effect and still reach the App.
    // A file moves off its list when it takes Obsidian from the capability
    // tags.
    {
      // An Obsidian view, which registers on its own lifecycle. The file
      // moves off the list when its view reads the tags.
      files: ["src/desktop/references/view.tsx"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // No tag member yet: `vault.getName`.
      files: ["src/obsidian/citation-index/cli/register.ts"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // No tag member yet: `vault.adapter`.
      files: ["src/desktop/pandoc-export/register.ts"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // Helpers and constructors that take a raw App object
      // (`documentPresentation(app.metadataCache, …)`).
      files: ["src/desktop/pandoc/register.ts"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // Default-runtime backlog: run the Effect through the bridge, a layer context runner or a runtime, then remove the file from the list.
      files: ["src/obsidian/citation-index/sources.ts"],
      rules: { "zotlit-services/no-default-runtime": "off" },
    },
    {
      files: ["src/core/pandoc/filter/zotlit-cite.pandoc.test.ts"],
      rules: {
        "effecttsgo/global-console": "off",
        "effecttsgo/global-console-in-effect": "off",
      },
    },
    {
      // Tests written before the rule that assert zt: classes; a file moves off
      // this list when its assertions move to behavior.
      files: [
        "src/desktop/citation-popover/content.test.ts",
        "src/obsidian/citekey-navigation/citation.test.ts",
        "src/obsidian/pandoc/inline-content.test.ts",
        "src/obsidian/cited-by/CitedBy.test.ts",
        "src/desktop/references/References.test.ts",
        "src/desktop/references/view.test.ts",
      ],
      rules: { "zotlit-tests/no-class-assertion": "off" },
    },
    ...testBaselineOverrides("packages/citations"),
  ],
});
