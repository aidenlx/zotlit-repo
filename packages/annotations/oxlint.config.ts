import type { OxlintOverride } from "oxlint";
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
import type { RestrictedImports } from "@zotlit/config/oxlint-plugin-code";

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
const featureImports = withPatterns(runtimeImports, [readerModules]);

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
  rules: pluginCodeRules(runtimeImports),
  overrides: [
    {
      files: ["src/**"],
      excludeFiles: NOT_TESTS,
      rules: { "no-restricted-imports": ["error", featureImports] },
    },
    ...pluginCodeOverrides({
      testImports: pluginTestImports,
      services: SERVICES,
      imports: featureImports,
    }),
    {
      files: ["src/*/annot-view/**"],
      rules: { "zotlit-obsidian/no-global-timer": "error" },
    },
    {
      files: ["src/*/annot-view/*.{ts,tsx}"],
      excludeFiles: ["**/*.test.{ts,tsx}"],
      rules: { "zotlit-design/annotation-view": "error" },
    },
    indexedDbYield("src/obsidian/excerpt-image/store.ts", featureImports),
    indexedDbYield(
      "src/obsidian/excerpt-image/store.browser-test.ts",
      runtimeImports,
    ),
    ...testBaselineOverrides("packages/annotations"),
  ],
});
