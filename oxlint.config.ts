import { defineConfig } from "oxlint";

import baseConfig, {
  datePattern,
  testBaselineOverrides,
} from "./packages/config/oxlint.base.ts";

export default defineConfig({
  extends: [baseConfig],
  ignorePatterns: [
    "**/dist/**",
    "**/dist-dev/**",
    "**/build/**",
    "**/.turbo/**",
    "**/.next/**",
    "**/node_modules/**",
    "**/coverage/**",
    "**/*.min.js",
    "pnpm-lock.yaml",
    ".agents/**",
    ".claude/**",
    ".scratch/**",
    "tests/fixture-vault-*/**",
    "packages/scripts/lib/fixture/vault-plugins/**",
    "packages/pdfjs-dist/**",
    "packages/pdfjs/dist/**",
    "video/**",
  ],
  overrides: [
    {
      files: ["packages/e2e/src/**/*.ts"],
      jsPlugins: ["./packages/config/oxlint-plugin-tests.ts"],
      rules: {
        "zotlit-tests/no-eval-capture": "error",
        "zotlit-tests/no-typed-arg-name": "error",
        "zotlit-tests/no-poll-adapter": "error",
        "zotlit-tests/no-poll-wrapper": "error",
        "zotlit-tests/no-generated-poll-label": "error",
        "zotlit-tests/no-string-transport": "error",
        "typescript/await-thenable": "error",
        "typescript/no-unnecessary-type-conversion": "error",
      },
    },
    {
      files: ["**/*.{test,spec}.{ts,tsx,js,jsx}"],
      plugins: ["vitest"],
      rules: {
        "typescript/no-floating-promises": "off",
      },
    },
    ...testBaselineOverrides(),
    {
      files: ["packages/config/oxlint-plugin-tests.test.ts"],
      rules: { "zotlit-tests/no-class-assertion": "off" },
    },
    {
      files: ["packages/e2e/src/walkthrough.e2e.ts"],
      rules: { "zotlit-tests/no-class-assertion": "off" },
    },
    {
      files: ["scripts/**"],
      rules: {
        "no-restricted-imports": ["error", { patterns: [datePattern] }],
      },
    },
  ],
});
