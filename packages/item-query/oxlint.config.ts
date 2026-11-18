import { defineConfig } from "oxlint";

import baseConfig, {
  datePattern,
  engineNodeOnlyOverride,
  hostModulePattern,
  itemQuerySchemaPaths,
  parentImportPattern,
  uniqueIdPaths,
} from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  rules: {
    "import/no-nodejs-modules": "error",
    // This package's runtime entry may re-export schema types, but not values.
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          parentImportPattern,
          datePattern,
          hostModulePattern,
          {
            group: [
              "./schema",
              "./schema.*",
              "./describe-attachment-query",
              "./describe-attachment-query.*",
              "./describe-annotation-query",
              "./describe-annotation-query.*",
              "./describe-item-query",
              "./describe-item-query.*",
            ],
            allowTypeImports: true,
            message:
              "The static Item Query Schema and vocabulary are build-only.",
          },
        ],
        paths: [...itemQuerySchemaPaths, ...uniqueIdPaths],
      },
    ],
  },
  overrides: [
    engineNodeOnlyOverride(),
    {
      // Static vocabulary generation and its direct tests own these values.
      files: [
        "src/schema.ts",
        "src/describe-item-query.ts",
        "src/describe-annotation-query.ts",
        "src/describe-attachment-query.ts",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [parentImportPattern, datePattern, hostModulePattern],
          },
        ],
      },
    },
    {
      files: [
        "src/**/*.{test,spec}.{ts,tsx,js,jsx}",
        "*.{config,setup}.{ts,js,mjs,cjs}",
        "scripts/**",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [parentImportPattern, datePattern],
          },
        ],
      },
    },
  ],
});
