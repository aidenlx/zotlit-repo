import { defineConfig } from "oxlint";

import baseConfig, {
  datePattern,
  itemQuerySchemaPaths,
  parentImportPattern,
  testBaselineOverrides,
} from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  plugins: [...(baseConfig.plugins ?? []), "nextjs"],
  rules: {
    "nextjs/google-font-display": "off",
    "nextjs/google-font-preconnect": "off",
    "nextjs/inline-script-id": "off",
    "nextjs/next-script-for-ga": "off",
    "nextjs/no-assign-module-variable": "off",
    "nextjs/no-async-client-component": "off",
    "nextjs/no-before-interactive-script-outside-document": "off",
    "nextjs/no-css-tags": "off",
    "nextjs/no-document-import-in-page": "off",
    "nextjs/no-duplicate-head": "off",
    "nextjs/no-head-element": "off",
    "nextjs/no-head-import-in-document": "off",
    "nextjs/no-html-link-for-pages": "off",
    "nextjs/no-img-element": "error",
    "nextjs/no-page-custom-font": "off",
    "nextjs/no-script-component-in-head": "off",
    "nextjs/no-styled-jsx-in-document": "off",
    "nextjs/no-sync-scripts": "off",
    "nextjs/no-title-in-document-head": "off",
    "nextjs/no-typos": "off",
    "nextjs/no-unwanted-polyfillio": "off",
    "no-restricted-imports": [
      "error",
      {
        patterns: [parentImportPattern, datePattern],
        paths: itemQuerySchemaPaths,
      },
    ],
  },
  overrides: [
    ...testBaselineOverrides("apps/docs"),
    {
      files: ["src/**"],
      rules: { "typescript/only-throw-error": "off" },
    },
    {
      files: [
        "src/lib/shared.ts",
        "src/routes/changelog/rss\\[.\\]xml.ts",
        "src/components/docs-last-updated.tsx",
        "src/lib/sitemap.ts",
      ],
      rules: {
        "effecttsgo/global-date": "off",
        "effecttsgo/global-date-in-effect": "off",
        "no-restricted-globals": "off",
        "typescript/no-restricted-types": "off",
      },
    },
    {
      files: ["scripts/**"],
      rules: {
        "no-restricted-imports": ["error", { patterns: [datePattern] }],
      },
    },
  ],
  ignorePatterns: [
    "src/routeTree.gen.ts",
    "worker-configuration.d.ts",
    "dist/**",
    ".tanstack/**",
  ],
});
