import type { PublishedPlugin, PublishedPluginName } from "./shell/plugins.ts";
import { PUBLISHED_PLUGINS } from "./shell/plugins.ts";

export function reviewedPlugin(): PublishedPlugin {
  const name = process.env.ZOTLIT_REVIEW_PLUGIN ?? "desktop";
  if (!(name in PUBLISHED_PLUGINS)) {
    throw new Error(
      `ZOTLIT_REVIEW_PLUGIN must be one of ${Object.keys(PUBLISHED_PLUGINS).join(", ")}, not ${name}.`,
    );
  }
  return PUBLISHED_PLUGINS[name as PublishedPluginName];
}
export const SCANNER_IGNORES = [
  "node_modules",
  "dist",
  "build",
  "pkg",
  "test-vault",
  ".obsidian",
  "**/.obsidian/**",
  "esbuild.config.mjs",
  "version-bump.mjs",
  "**/*.test.*",
  "**/*.tests.*",
  "**/*.spec.*",
  "**/*.specs.*",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/mocks/**",
  "**/__mocks__/**",
  "**/*.cjs",
  "**/*.mjs",
  "**/*.cts",
  "**/*.mts",
  "**/vite*",
  "**/scripts/**",
  "**/docs/**",
  "**/i18n/**",
  "**/i18next/**",
  "**/locale/**",
  "**/locales/**",
  "**/translations/**",
  "**/l10n/**",
  ".pnpm-store",
  "**/*.spec.ts",
  "**/testUtils**",
  "automation/**",
  "e2e-tests/**",
];
