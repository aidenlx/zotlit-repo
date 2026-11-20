// The lint rules of the ZotLit Obsidian plugin's code: the app
// (apps/obsidian) and the plugin packages it bundles (plugin-kernel,
// obsidian-kit, obsidian-desktop, zotero-reads, plugin-services, annotations,
// citations, notes, template-workbench, query-views, library-view), and
// ZotLit Reader (apps/reader, reader-feature).
// Each of those lint configs spreads these and adds the overrides that name its
// own files.
import { join } from "node:path";
import type { DummyRuleMap, OxlintOverride } from "oxlint";

import {
  datePattern,
  itemQuerySchemaPaths,
  parentImportPattern,
  uniqueIdPaths,
} from "./oxlint.base.ts";

const plugin = (name: string) => join(import.meta.dirname, name);

/** The custom plugins plugin code loads. */
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
  group: string[];
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

// The wrappers are applied by the effectEntry Vite plugin
// (packages/plugin-kernel/scripts/effect-entry.ts); code imports the package
// names.
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

/** The CLI-guarded citation scan, which plugin code reads through the worker. */
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

// LogTape's own configure and reset clear the loggers of every plugin on the
// window-wide root logger and leave a host-process listener;
// packages/plugin-kernel/src/log.ts changes only the plugin's own sinks.
export const logTapeConfigurePath: ImportPath = {
  name: "@logtape/logtape",
  importNames: ["configure", "configureSync", "reset"],
  message:
    "Give the plugin's loggers their sinks and levels through pluginLogTape from @zotlit/plugin-kernel/log.ts.",
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
    logTapeConfigurePath,
    ...commonImports.paths,
  ],
};

/** Adds patterns (a package's layer boundary) to every restatement of the rule. */
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

/** The top-level rules of plugin code; `imports` is its `no-restricted-imports`. */
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
    // Repeats the base pattern: a rule set here replaces the base entry.
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

/**
 * The overrides every plugin code config shares, with globs relative to its
 * directory (`src/**`). `imports` is the config's `no-restricted-imports`;
 * the test override relaxes it to `testImports`. `services` names the files
 * that hold Effect services: the app's `src/services/**`, or the whole
 * source of a package of services.
 */
export function pluginCodeOverrides({
  testImports,
  services = ["src/services/**"],
}: {
  testImports: RestrictedImports;
  services?: string[];
}): OxlintOverride[] {
  return [
    {
      // Obsidian's guideline rules, on the code that ships. `pnpm review` runs
      // the type-aware rest.
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
      rules: { "zotlit-logging/no-logtape-in-effect-file": "error" },
    },
    {
      files: ["src/**"],
      excludeFiles: ["src/**/*.test.{ts,tsx}"],
      rules: { "zotlit-errors/no-message-match": "error" },
    },
    {
      // Tests may use LogTape directly.
      files: ["src/**/*.test.{ts,tsx}"],
      rules: { "zotlit-logging/no-logtape-in-effect-file": "off" },
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
    // A test double needs no span: service methods are Effect.fn in the plugin
    // code only.
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
        // Test support and benchmarks, not plugin code: no plugin runtime exists there.
        "**/test-harness.ts",
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
        // Benchmarks measure wall time on purpose.
        "**/*.bench.ts",
      ],
      rules: { "zotlit-services/clock-time": "error" },
    },
    {
      files: ["src/**/*.{ts,tsx}"],
      rules: { "zotlit-services/temporal-in-effect": "error" },
    },
    {
      // UI code runs in the window it stands in, a pop-out included.
      files: ["src/views/**", "src/components/**", "src/**/*.tsx"],
      rules: { "zotlit-obsidian/no-global-timer": "error" },
    },
    {
      // So does UI that services draw, such as a picker; tests keep the
      // timers their fakes replace.
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
      // React draws its controls from JSX; imperative DOM builds on Obsidian's.
      files: ["src/**/*.tsx"],
      rules: {
        "zotlit-css/no-obsidian-class": "error",
        "zotlit-css/no-setting-in-react": "error",
      },
    },
    {
      // Tests can inspect the schema; the plugin's other import rules remain.
      files: [
        "src/**/*.{test,spec}.{ts,tsx,js,jsx}",
        "*.{config,setup}.{ts,js,mjs,cjs}",
      ],
      rules: { "no-restricted-imports": ["error", testImports] },
    },
  ];
}

/** The test override's `no-restricted-imports`: the wrappers and the Obsidian paths. */
export const pluginTestImports: RestrictedImports = {
  patterns: [parentImportPattern, datePattern],
  paths: [...effectWrapperPaths, ...obsidianImportPaths],
};
