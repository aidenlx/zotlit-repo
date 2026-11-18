import { defineConfig } from "oxlint";

import baseConfig, {
  datePattern,
  engineNodeOnlyOverride,
  itemQuerySchemaPaths,
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

// The Obsidian layer loads in Obsidian Mobile: no Node built-in and no
// Electron, and nothing of the desktop layer above it.
const layerPattern = {
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
    "The Obsidian kit loads on Obsidian Mobile, where Node and Electron are absent; desktop-only code belongs in @zotlit/obsidian-desktop.",
};
const imports = withPatterns(runtimeImports, [layerPattern]);

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: pluginCodeJsPlugins,
  rules: {
    ...pluginCodeRules(imports),
    "import/no-nodejs-modules": "error",
  },
  overrides: [
    ...pluginCodeOverrides({
      testImports: withPatterns(pluginTestImports, [layerPattern]),
    }),
    engineNodeOnlyOverride([
      "src/**/__fixtures__/**",
      "src/__mocks__/**",
      "vitest.preset.ts",
    ]),
    {
      // The capability tags themselves read the App.
      files: ["src/obsidian-*.ts"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // The wrappers that hand Obsidian's control classes to everything else.
      files: ["src/components/obsidian/**"],
      rules: { "zotlit-css/no-obsidian-class": "off" },
    },
    {
      // The one module that wraps Obsidian's popover itself.
      files: ["src/hover-popover.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [datePattern, layerPattern],
            paths: itemQuerySchemaPaths,
          },
        ],
      },
    },
    {
      // This stand-in implements the runtime helper that the rule requires.
      files: ["vitest.setup.js"],
      rules: { "zotlit-obsidian/no-cross-window-instanceof": "off" },
    },
    {
      // Background work that stands in no window, which lives as long as the
      // plugin and so as the main window.
      files: ["src/disposables.ts"],
      rules: { "zotlit-obsidian/no-global-timer": "off" },
    },
    ...testBaselineOverrides("packages/obsidian-kit"),
  ],
});
