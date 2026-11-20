import { defineConfig } from "oxlint";

import baseConfig, { testBaselineOverrides } from "@zotlit/config/oxlint";
import {
  pluginCodeJsPlugins,
  pluginCodeOverrides,
  pluginCodeRules,
  pluginTestImports,
  runtimeImports,
  withPatterns,
} from "@zotlit/config/oxlint-plugin-code";

const desktopModules = {
  group: [
    "electron",
    "electron/**",
    "@electron/remote",
    "@electron/remote/**",
    "@zotlit/obsidian-desktop",
    "@zotlit/obsidian-desktop/**",
    "@zotlit/plugin-services/desktop/**",
    "@zotlit/plugin-shell/desktop/**",
  ],
  message:
    "ZotLit Reader loads on Obsidian Mobile, where Node and Electron are absent.",
};
const zoteroPackages = {
  group: [
    "@zotlit/annotations",
    "@zotlit/annotations/**",
    "@zotlit/db",
    "@zotlit/db/**",
    "@zotlit/item-lookup",
    "@zotlit/item-lookup/**",
    "@zotlit/item-query",
    "@zotlit/item-query/**",
    "@zotlit/protocol",
    "@zotlit/protocol/**",
    "@zotlit/zotero-reads",
    "@zotlit/zotero-reads/**",
    "@zotlit/zotero-types",
    "@zotlit/zotero-types/**",
    "@zotlit/plugin-shell/obsidian/platform.ts",
  ],
  message:
    "ZotLit Reader works without Zotero; ZotLit adds its Zotero features through the reader's extensions.",
};

const readerImports = withPatterns(runtimeImports, [
  desktopModules,
  zoteroPackages,
]);

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: pluginCodeJsPlugins,
  rules: {
    ...pluginCodeRules(readerImports),
    "import/no-nodejs-modules": "error",
  },
  overrides: [
    ...pluginCodeOverrides({ testImports: pluginTestImports }),
    ...testBaselineOverrides("packages/reader-feature"),
  ],
});
