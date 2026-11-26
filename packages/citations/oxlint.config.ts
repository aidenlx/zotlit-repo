import { defineConfig } from "oxlint";

import baseConfig, { testBaselineOverrides } from "@zotlit/config/oxlint";
import {
  pluginCodeJsPlugins,
  pluginCodeOverrides,
  pluginCodeRules,
  pluginTestImports,
  runtimeImports,
} from "@zotlit/config/oxlint-plugin-code";
import type { RestrictedImports } from "@zotlit/config/oxlint-plugin-code";

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
  rules: pluginCodeRules(runtimeImports),
  overrides: [
    {
      files: ["src/obsidian/citekey-editor/decorate.ts"],
      rules: {
        "no-restricted-imports": ["error", withoutScanGuard(runtimeImports)],
      },
    },
    ...pluginCodeOverrides({
      testImports: pluginTestImports,
      services: SERVICES,
    }),
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
