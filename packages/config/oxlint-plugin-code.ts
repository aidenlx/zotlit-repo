import { join } from "node:path";
import type { DummyRuleMap, OxlintOverride } from "oxlint";

import {
  datePattern,
  itemQuerySchemaPaths,
  parentImportPattern,
  uniqueIdPaths,
} from "./oxlint.base.ts";

const plugin = (name: string) => join(import.meta.dirname, name);

export const pluginCodeJsPlugins: string[] = [
  plugin("oxlint-plugin-design.ts"),
  plugin("oxlint-plugin-popout-windows.ts"),
  plugin("oxlint-plugin-menu-sections.ts"),
  plugin("oxlint-plugin-obsidian-css.ts"),
  plugin("oxlint-plugin-private-api.ts"),
  plugin("oxlint-plugin-services.ts"),
  plugin("oxlint-plugin-effect-tests.ts"),
  plugin("oxlint-plugin-logging.ts"),
  plugin("oxlint-plugin-errors.ts"),
  plugin("oxlint-plugin-effect-style.ts"),
  plugin("oxlint-plugin-keyboard.ts"),
  plugin("oxlint-plugin-obsidian.ts"),
];

type ImportPath = {
  name: string;
  importNames?: string[];
  allowImportNames?: string[];
  allowTypeImports?: boolean;
  message?: string;
};
type ImportPattern = {
  group?: string[];
  regex?: string;
  importNames?: string[];
  allowTypeImports?: boolean;
  message?: string;
};
export type RestrictedImports = {
  patterns: ImportPattern[];
  paths: ImportPath[];
};

export const obsidianImportPaths: ImportPath[] = [
  {
    name: "semver",
    allowTypeImports: true,
    message:
      "Import from semver/functions/<name> to keep unused semver code out of the plugin bundle.",
  },
  {
    name: "obsidian",
    importNames: ["HoverPopover"],
    allowTypeImports: true,
    message:
      "Extend HoverPopover from @zotlit/obsidian-kit/hover-popover.ts; it cancels Obsidian's popover timers on the window that armed them and keeps a popover in its own window (see policies/hover-popover.md).",
  },
  ...uniqueIdPaths,
];

export const effectWrapperPaths: ImportPath[] = [
  ...["@zotlit/plugin-kernel/effect.ts", "#effect.ts"].map((name) => ({
    name,
    message:
      'Import from "effect": the effectEntry Vite plugin (packages/plugin-kernel/scripts/effect-entry.ts) resolves "effect" to this wrapper.',
  })),
  ...["@zotlit/plugin-kernel/effect-vitest.ts", "#effect-vitest.ts"].map(
    (name) => ({
      name,
      message:
        'Import from "@effect/vitest": the effectEntry Vite plugin (packages/plugin-kernel/scripts/effect-entry.ts) resolves "@effect/vitest" to this wrapper in tests.',
    }),
  ),
];

const scanPattern: ImportPattern = {
  group: ["**/citation-index/scan.ts", "./scan.ts"],
  importNames: [
    "scanDocumentCitations",
    "scanCitekeyOccurrences",
    "documentWikilinks",
    "maskExclusions",
    "maskWikilinks",
  ],
  message: "Read document citations through the citation parse worker.",
};

export const commonImports: RestrictedImports = {
  patterns: [parentImportPattern, datePattern, scanPattern],
  paths: [...obsidianImportPaths, ...itemQuerySchemaPaths],
};

export const runtimeImports: RestrictedImports = {
  ...commonImports,
  paths: [
    {
      name: "effect",
      importNames: ["ManagedRuntime", "Scheduler"],
      allowTypeImports: true,
      message:
        "Run Effects with the run functions of Effect from effect instead; they supply the browser scheduler.",
    },
    {
      name: "effect/Effect",
      allowTypeImports: true,
      message: "Import Effect from effect.",
    },
    {
      name: "effect/ManagedRuntime",
      allowTypeImports: true,
      message:
        "Use the Effect entry points from effect for Chromium scheduling.",
    },
    {
      name: "effect/Scheduler",
      allowTypeImports: true,
      message:
        "Obsidian scheduling is owned by @zotlit/plugin-kernel/effect-runtime.ts and @zotlit/plugin-kernel/browser-scheduler.ts.",
    },
    ...effectWrapperPaths,
    ...commonImports.paths,
  ],
};

export function withPatterns(
  options: RestrictedImports,
  patterns: ImportPattern[],
): RestrictedImports {
  return { ...options, patterns: [...options.patterns, ...patterns] };
}

export const readerImports: RestrictedImports = withPatterns(runtimeImports, [
  {
    group: [
      "electron",
      "electron/**",
      "@electron/remote",
      "@electron/remote/**",
      "@effect/platform-node",
      "@effect/platform-node/**",
      "@zotlit/obsidian-desktop",
      "@zotlit/obsidian-desktop/**",
      "@zotlit/plugin-services/desktop/**",
      "@zotlit/plugin-shell/desktop/**",
    ],
    message:
      "ZotLit Reader loads on Obsidian Mobile, where Node and Electron are absent.",
  },
  {
    group: [
      "@zotlit/annotations",
      "@zotlit/annotations/**",
      "@zotlit/citations",
      "@zotlit/citations/**",
      "@zotlit/db",
      "@zotlit/db/**",
      "@zotlit/item-lookup",
      "@zotlit/item-lookup/**",
      "@zotlit/item-query",
      "@zotlit/item-query/**",
      "@zotlit/library-view",
      "@zotlit/library-view/**",
      "@zotlit/notes",
      "@zotlit/notes/**",
      "@zotlit/protocol",
      "@zotlit/protocol/**",
      "@zotlit/query-views",
      "@zotlit/query-views/**",
      "@zotlit/template-workbench",
      "@zotlit/template-workbench/**",
      "@zotlit/zotero-reads",
      "@zotlit/zotero-reads/**",
      "@zotlit/zotero-types",
      "@zotlit/zotero-types/**",
      "@zotlit/plugin-shell/obsidian/platform.ts",
    ],
    message:
      "ZotLit Reader works without Zotero: it composes platformBase, and ZotLit adds its Zotero features through the reader's extensions.",
  },
]);

export function pluginCodeRules(imports: RestrictedImports): DummyRuleMap {
  return {
    "effecttsgo/global-console": "error",
    "effecttsgo/global-console-in-effect": "error",
    "zotlit-obsidian/no-cross-window-instanceof": "error",
    "zotlit-obsidian/no-global-resize-observer": "error",
    "zotlit-keyboard/no-layer-check": "error",
    "zotlit-menu/no-literal-section": "error",
    "zotlit-services/service-tag-id": "error",
    "zotlit-services/no-plain-service-adapters": "error",
    "zotlit-services/cli-command-registration": "error",
    "zotlit-effect-style/no-tacit": "error",
    "no-restricted-imports": ["error", imports],
  };
}

const TESTS = [
  "**/*.test.{ts,tsx}",
  "**/*.bench.ts",
  "**/*.browser-test.ts",
  "**/__fixtures__/**",
  "**/__fixtures__.ts",
];

export function pluginCodeOverrides({
  testImports,
  services = ["src/services/**"],
}: {
  testImports: RestrictedImports;
  services?: string[];
}): OxlintOverride[] {
  return [
    {
      files: ["src/**"],
      excludeFiles: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.bench.ts",
        "src/**/*.browser-test.ts",
        "src/**/__fixtures__/**",
        "src/**/__fixtures__.ts",
        "src/**/__mocks__/**",
      ],
      rules: {
        "obsidianmd/no-nodejs-modules": "off",
        "obsidianmd/rule-custom-message": [
          "error",
          {
            "no-console": {
              messages: {
                "Unexpected console statement. Only these console methods are allowed: warn, error, debug.":
                  "Avoid unnecessary logging to console. See https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines#Avoid+unnecessary+logging+to+console",
              },
              options: [{ allow: ["warn", "error", "debug"] }],
            },
            "no-new-func": {
              messages: {
                "The Function constructor is eval":
                  "Using the `Function` constructor is dangerous because it executes arbitrary code, similar to `eval()`",
              },
            },
          },
        ],
        "obsidianmd/commands/no-command-in-command-id": "error",
        "obsidianmd/commands/no-command-in-command-name": "error",
        "obsidianmd/commands/no-default-hotkeys": "error",
        "obsidianmd/commands/no-plugin-id-in-command-id": "error",
        "obsidianmd/commands/no-plugin-name-in-command-name": "error",
        "obsidianmd/settings-tab/no-manual-html-headings": "error",
        "obsidianmd/settings-tab/no-problematic-settings-headings": "error",
        "obsidianmd/settings-tab/require-display": "error",
        "obsidianmd/settings-tab/prefer-setting-definitions": "error",
        "obsidianmd/settings-tab/prefer-update-over-display": "error",
        "obsidianmd/settings-tab/no-deprecated-display": "error",
        "obsidianmd/vault/iterate": "error",
        "obsidianmd/detach-leaves": "error",
        "obsidianmd/editor-drop-paste": "error",
        "obsidianmd/hardcoded-config-path": "error",
        "obsidianmd/no-forbidden-elements": "error",
        "obsidianmd/no-global-this": "error",
        "obsidianmd/no-restricted-globals": "error",
        "obsidianmd/no-sample-code": "error",
        "obsidianmd/no-tfile-tfolder-cast": "error",
        "obsidianmd/no-static-styles-assignment": "error",
        "obsidianmd/object-assign": "error",
        "obsidianmd/platform": "error",
        "obsidianmd/prefer-get-language": "error",
        "obsidianmd/prefer-abstract-input-suggest": "error",
        "obsidianmd/prefer-window-timers": "error",
        "obsidianmd/prefer-active-doc": "off",
        "obsidianmd/regex-lookbehind": "error",
        "obsidianmd/sample-names": "error",
      },
    },
    {
      files: ["src/**"],
      rules: { "zotlit-services/worker-rpc": "error" },
    },
    {
      files: ["src/**"],
      rules: { "zotlit-logging/effect-logging-only": "error" },
    },
    {
      files: ["src/**"],
      excludeFiles: ["src/**/*.test.{ts,tsx}"],
      rules: { "zotlit-errors/no-message-match": "error" },
    },
    {
      files: ["src/**/*.test.{ts,tsx}"],
      rules: {
        "zotlit-effect-tests/no-effect-run-in-test": "error",
        "zotlit-effect-tests/no-notice-mock": "error",
        "zotlit-effect-tests/no-real-timer-in-effect-test": "error",
      },
    },
    {
      files: ["src/**"],
      rules: { "zotlit-effect-tests/service-stub": "error" },
    },
    {
      files: [
        "src/**/*.test.{ts,tsx}",
        "src/**/__fixtures__.ts",
        "src/**/__fixtures__/**",
      ],
      rules: { "zotlit-effect-tests/typed-fake": "error" },
    },
    {
      files: ["src/**"],
      excludeFiles: ["**/*.test.{ts,tsx}"],
      rules: {
        "zotlit-services/effect-native-resources": "error",
        "zotlit-services/interrupt-predicate": "error",
        "zotlit-services/layer-stream-consumer": "error",
        "zotlit-services/no-legacy-service": "error",
        "zotlit-services/scope-closed": "error",
      },
    },
    {
      files: ["src/**"],
      excludeFiles: [
        "**/*.test.{ts,tsx}",
        "**/__fixtures__/**",
        "**/__fixtures__.ts",
        "**/__mocks__/**",
      ],
      rules: { "zotlit-services/obsidian-capabilities": "error" },
    },
    {
      files: TESTS,
      rules: { "effecttsgo/effect-fn-opportunity": "off" },
    },
    {
      files: ["src/**"],
      rules: { "zotlit-services/no-nanoevents": "error" },
    },
    {
      files: ["src/**/*.{ts,tsx}"],
      excludeFiles: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.browser-test.ts",
        "**/__fixtures__/**",
        "**/__fixtures__.ts",
        "**/__mocks__/**",
        "**/test-harness.ts",
        "**/test-host.tsx",
        "**/*.bench.ts",
      ],
      rules: { "zotlit-services/no-default-runtime": "error" },
    },
    {
      files: services,
      excludeFiles: [
        "**/*.test.{ts,tsx}",
        "**/*.browser-test.ts",
        "**/__fixtures__/**",
        "**/__fixtures__.ts",
        "**/test-harness.ts",
      ],
      rules: { "zotlit-services/scoped-runner": "error" },
    },
    {
      files: ["src/**/*.{ts,tsx}"],
      excludeFiles: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.browser-test.ts",
        "**/__fixtures__/**",
        "**/__fixtures__.ts",
        "**/__mocks__/**",
        "**/*.bench.ts",
      ],
      rules: { "zotlit-services/clock-time": "error" },
    },
    {
      files: ["src/**/*.{ts,tsx}"],
      rules: { "zotlit-services/temporal-in-effect": "error" },
    },
    {
      files: ["src/views/**", "src/components/**", "src/**/*.tsx"],
      rules: { "zotlit-obsidian/no-global-timer": "error" },
    },
    {
      files: ["src/**"],
      excludeFiles: [
        "**/*.test.{ts,tsx}",
        "**/*.browser-test.ts",
        "**/__fixtures__/**",
        "**/__fixtures__.{ts,tsx}",
        "**/__mocks__/**",
      ],
      rules: { "zotlit-obsidian/no-global-timer": "error" },
    },
    {
      files: ["src/**/*.tsx"],
      rules: {
        "zotlit-css/no-obsidian-class": "error",
        "zotlit-css/no-setting-in-react": "error",
      },
    },
    {
      files: [
        "src/**/*.{test,spec}.{ts,tsx,js,jsx}",
        "*.{config,setup}.{ts,js,mjs,cjs}",
      ],
      rules: { "no-restricted-imports": ["error", testImports] },
    },
  ];
}

export const pluginTestImports: RestrictedImports = {
  patterns: [parentImportPattern, datePattern],
  paths: [...effectWrapperPaths, ...obsidianImportPaths],
};
