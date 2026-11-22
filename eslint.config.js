import json from "@eslint/json";
import obsidianmd from "eslint-plugin-obsidianmd";
import { globalIgnores } from "eslint/config";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import tseslint from "typescript-eslint";

import { reviewedPluginPackages } from "./packages/scripts/lib/plugin-packages.ts";
import {
  reviewedPlugin,
  SCANNER_IGNORES,
} from "./packages/scripts/lib/scanner-eslint.ts";

const plugin = reviewedPlugin();
const pkg = JSON.parse(
  readFileSync(join(import.meta.dirname, plugin.app, "package.json"), "utf8"),
);

function toWarns(config) {
  if (!config.rules) return config;
  const rules = Object.entries(config.rules).map(([key, value]) => {
    if (key.startsWith("eslint-comments/")) return [key, value];
    if (value === "error" || value === 2) return [key, "warn"];
    if (Array.isArray(value) && (value[0] === "error" || value[0] === 2))
      return [key, ["warn", ...value.slice(1)]];
    return [key, value];
  });
  return { ...config, rules: Object.fromEntries(rules) };
}

const PLUGIN_SOURCES = [
  `${plugin.app}/src`,
  ...reviewedPluginPackages(join(import.meta.dirname, plugin.app)).map(
    ({ root }) => `${relative(import.meta.dirname, root)}/src`,
  ),
];

export default [
  {
    ignores: [
      "**/*",
      "!apps/",
      "!packages/",
      ...PLUGIN_SOURCES.flatMap((source) => [
        `!${source.split("/").slice(0, 2).join("/")}/`,
        `!${source}/`,
        `!${source}/**`,
      ]),
      "!manifest.json",
    ],
  },

  {
    files: PLUGIN_SOURCES.map((source) => `${source}/**/*.{ts,tsx}`),
    languageOptions: {
      parserOptions: {
        project: `./${plugin.app}/tsconfig.review.json`,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  ...obsidianmd.configs.recommended.map(toWarns),

  {
    linterOptions: {
      noInlineConfig: false,
      reportUnusedDisableDirectives: "off",
      reportUnusedInlineConfigs: "off",
    },
  },

  {
    files: ["**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}"],
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
      "obsidianmd/regex-lookbehind": [
        "error",
        { isDesktopOnly: pkg.obsidian.isDesktopOnly },
      ],
      "obsidianmd/no-forbidden-elements": "error",

      "no-undef": "off",
      "import/no-unresolved": "off",

      "obsidianmd/validate-manifest": "off",
      "obsidianmd/validate-license": "off",
    },
  },

  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    plugins: { "@typescript-eslint": tseslint.plugin, obsidianmd },
    rules: {
      "obsidianmd/ui/sentence-case": "off",
      "obsidianmd/ui/sentence-case-json": "off",
      "obsidianmd/ui/sentence-case-locale-module": "off",

      "eslint-comments/require-description": "error",

      "obsidianmd/settings-tab/no-manual-html-headings": "error",
      "obsidianmd/settings-tab/no-problematic-settings-headings": [
        "error",
        { pluginName: pkg.obsidian.name },
      ],
      "obsidianmd/sample-names": "error",
      "obsidianmd/no-sample-code": "error",
      "obsidianmd/platform": "error",
      "obsidianmd/no-plugin-as-component": "error",
      "obsidianmd/detach-leaves": "error",
      "obsidianmd/no-static-styles-assignment": "error",
      "obsidianmd/no-view-references-in-plugin": "error",
      "obsidianmd/no-unsupported-api": [
        "error",
        { minAppVersion: pkg.obsidian.minAppVersion },
      ],
    },
  },

  globalIgnores(SCANNER_IGNORES),

  {
    files: ["manifest.json"],
    language: "json/json",
    plugins: { json, obsidianmd },
    rules: { "obsidianmd/validate-manifest": "error" },
  },
];
