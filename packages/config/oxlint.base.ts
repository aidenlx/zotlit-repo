import { recommended } from "@effect/tsgo/oxlint-presets";
import { join } from "node:path";
import { defineConfig } from "oxlint";
import type { OxlintOverride } from "oxlint";

import testBaseline from "./oxlint-tests-baseline.json" with { type: "json" };

export const parentImportPattern = {
  group: ["../**"],
  message: "Use @/ alias instead of parent-directory relative imports.",
};

export const itemQuerySchemaPaths = [
  {
    name: "@zotlit/item-query/schema",
    allowTypeImports: true,
    message:
      "The Item Query Schema is build-only. Import runtime values from @zotlit/item-query.",
  },
  {
    name: "@zotlit/item-query/query.schema.json",
    allowTypeImports: true,
    message:
      "The generated Item Query Schema is build-only and must stay out of runtime bundles.",
  },
];

export const fileSystemAdapterPath = {
  name: "obsidian",
  importNames: ["FileSystemAdapter"],
  message:
    "This file loads on Obsidian Mobile, where the vault has no folder on disk and the file-system adapter is absent. Read the vault's place on disk from VaultDisk (@zotlit/obsidian-kit/obsidian-vault-disk.ts), which only a desktop Layer supplies.",
};

export const uniqueIdPaths = ["react", "preact/compat", "preact/hooks"].map(
  (name) => ({
    name,
    importNames: ["useId"],
    message:
      "Use useUniqueId from @zotlit/ui: useId counts within one Preact root, so two views in one window share its ids.",
  }),
);

export function withoutFileSystemAdapter<
  T extends { readonly paths: readonly object[] },
>(options: T): T {
  return {
    ...options,
    paths: options.paths.filter((path) => path !== fileSystemAdapterPath),
  };
}

const dateFix =
  "Use Temporal outside Effect and DateTime in Effect code (DateTime.now or Clock for the current time). A library that takes or gives a Date converts in its adapter module.";

export const dateGlobals = {
  globals: [{ name: "Date", message: dateFix }],
  checkGlobalObject: true,
};

const nodeGlobalFix =
  "This file also loads in a Web Worker or on Obsidian Mobile, where Node is absent. Take the value from the host: a service such as ObsidianEnv, or a parameter that the desktop host passes.";

export const nodeImportFix =
  "This file also loads in a Web Worker or on Obsidian Mobile, where Node is absent. Put the Node code in a desktop-zone file behind a service that only the desktop host supplies.";

export const nodeGlobalNames = ["process", "Buffer", "require"];

export const nodeGlobals = {
  globals: nodeGlobalNames.map((name) => ({
    name,
    message: nodeGlobalFix,
  })),
  checkGlobalObject: true,
};

export const nodeFreeGlobals = {
  globals: [...dateGlobals.globals, ...nodeGlobals.globals],
  checkGlobalObject: true,
};

const nodeExemptFiles = [
  "**/*.{test,spec,bench,browser-test}.{ts,tsx,js,mjs}",
  "**/*.e2e.ts",
  "**/__fixtures__/**",
  "**/__fixtures__.ts",
  "**/__mocks__/**",
  "**/*.{config,setup,preset}.{ts,js,mjs,cjs}",
  "scripts/**",
  "{apps,packages}/*/scripts/**",
  "**/src/desktop/**",
];

export function nodeAllowed(files: string[]): OxlintOverride {
  return {
    files,
    rules: {
      "no-restricted-globals": ["error", dateGlobals],
      "zotlit-runtime/no-node-builtin": "off",
    },
  };
}

export const dateTypes = { types: { Date: dateFix } };

export const datePattern = {
  group: ["date-fns", "date-fns/**", "dayjs", "dayjs/**"],
  message: dateFix,
};

export const baseImports = {
  patterns: [parentImportPattern, datePattern],
  paths: [...itemQuerySchemaPaths, ...uniqueIdPaths, fileSystemAdapterPath],
};

const EFFECT_TESTS_CONFIGS = new Set([
  "apps/obsidian",
  "packages/plugin-kernel",
  "packages/obsidian-kit",
  "packages/obsidian-desktop",
  "packages/zotero-reads",
  "packages/plugin-services",
  "packages/plugin-shell",
  "packages/annotations",
  "packages/citations",
  "packages/notes",
  "packages/template-workbench",
  "packages/query-views",
  "packages/library-view",
]);

export function testBaselineOverrides(directory?: string) {
  const prefix = directory ? `${directory}/` : "";
  const filesByRule = new Map<string, string[]>();
  for (const [file, rules] of Object.entries(
    testBaseline as Record<string, string[]>,
  )) {
    if (!file.startsWith(prefix)) continue;
    for (const rule of rules) {
      if (rule.startsWith("test-policy/")) continue;
      if (
        rule.startsWith("zotlit-effect-tests/") &&
        !EFFECT_TESTS_CONFIGS.has(directory ?? "")
      )
        continue;
      filesByRule.set(rule, [
        ...(filesByRule.get(rule) ?? []),
        file.slice(prefix.length),
      ]);
    }
  }
  return [...filesByRule].map(([rule, files]) => ({
    files,
    rules: { [rule]: "off" as const },
  }));
}

const effectOptInRules = [
  "global-date",
  "global-date-in-effect",
  "global-fetch-in-effect",
  "global-timers-in-effect",
  "process-env-in-effect",
].map((rule) => [`effecttsgo/${rule}`, "error"] as const);

const effectV3OnlyRules = [
  "generic-effect-services",
  "missing-effect-service-dependency",
  "non-object-effect-service-type",
  "schema-union-of-literals",
  "scope-in-layer-effect",
].map((rule) => [`effecttsgo/${rule}`, "off"] as const);

const effectOffRules = ["any-unknown-in-error-context"].map(
  (rule) => [`effecttsgo/${rule}`, "off"] as const,
);

export default defineConfig({
  extends: [recommended],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  plugins: [
    "react",
    "react-perf",
    "eslint",
    "typescript",
    "unicorn",
    "oxc",
    "import",
    "promise",
    "vitest",
  ],
  jsPlugins: [
    join(import.meta.dirname, "oxlint-plugin-build.ts"),
    join(import.meta.dirname, "oxlint-plugin-comments.ts"),
    join(import.meta.dirname, "oxlint-plugin-messages.ts"),
    join(import.meta.dirname, "oxlint-plugin-runtime.ts"),
  ],
  rules: {
    "zotlit-build/no-undeclared-env": "error",
    "zotlit-build/no-app-path": "error",
    "zotlit-comments/no-tracker-reference": "error",
    "zotlit-messages/no-computed-message": "error",
    "import/extensions": [
      "error",
      "always",
      { ignorePackages: true, checkTypeImports: true },
    ],
    "no-restricted-globals": ["error", nodeFreeGlobals],
    "zotlit-runtime/no-node-builtin": ["error", { message: nodeImportFix }],
    "typescript/no-restricted-types": ["error", dateTypes],
    ...Object.fromEntries(effectOptInRules),
    ...Object.fromEntries(effectV3OnlyRules),
    ...Object.fromEntries(effectOffRules),
    "typescript/prefer-promise-reject-errors": "error",
    "typescript/only-throw-error": "error",
    "typescript/no-unnecessary-type-assertion": "error",
    "typescript/no-misused-promises": "error",
    "typescript/no-unsafe-enum-comparison": "error",
    "typescript/no-unsafe-function-type": "error",
    "typescript/no-this-alias": "error",
    "typescript/no-empty-object-type": "error",
    "typescript/unbound-method": "error",
    "typescript/no-non-null-asserted-optional-chain": "error",
    "eslint/no-fallthrough": "error",
    "eslint/no-var": "error",
    "eslint/no-unexpected-multiline": "error",
    "eslint/no-self-compare": "error",
    "eslint/no-empty": "error",
    "eslint/require-yield": "error",
    "eslint/no-misleading-character-class": "error",
    "eslint/no-irregular-whitespace": "error",
    "eslint/no-unsafe-optional-chaining": "error",
    "eslint/no-unsafe-finally": "error",
    "eslint/no-shadow-restricted-names": "error",
    "eslint/no-constant-binary-expression": "error",
    "typescript/no-non-null-assertion": "off",
    "typescript/no-explicit-any": "off",
    "typescript/ban-ts-comment": "off",
    "typescript/prefer-readonly": "error",
    "typescript/no-redundant-type-constituents": "error",

    "no-unused-vars": "error",
    "no-param-reassign": "error",
    "default-param-last": "error",
    "max-params": ["error", { max: 3 }],
    "vitest/no-large-snapshots": ["error", { inlineMaxSize: 50 }],
    "vitest/no-conditional-expect": "error",
    "typescript/no-floating-promises": "error",
    "vitest/valid-expect": "off",
    "vitest/require-to-throw-message": "off",
    "vitest/require-mock-type-parameters": "off",
    "vitest/expect-expect": "off",
    "vitest/no-standalone-expect": "off",
    "vitest/valid-describe-callback": "off",
    "vitest/valid-title": "off",
    "no-else-return": "error",
    "prefer-template": "warn",
    "no-useless-concat": "error",

    "unicorn/prefer-number-properties": "error",
    "unicorn/prefer-string-replace-all": "error",
    "no-restricted-imports": ["error", baseImports],
    "typescript/consistent-type-imports": [
      "error",
      { fixStyle: "separate-type-imports", disallowTypeAnnotations: false },
    ],
    "import/consistent-type-specifier-style": ["error", "prefer-top-level"],
  },
  overrides: [
    nodeAllowed(nodeExemptFiles),
    {
      files: ["**/*.test.{ts,tsx,mts,mjs,js}"],
      jsPlugins: [join(import.meta.dirname, "oxlint-plugin-tests.ts")],
      rules: {
        "zotlit-tests/no-source-text": "error",
        "zotlit-tests/no-internal-mock": "error",
      },
    },
    {
      files: ["**/*.{test,spec}.{ts,tsx}", "**/*.e2e.ts"],
      jsPlugins: [join(import.meta.dirname, "oxlint-plugin-tests.ts")],
      rules: { "zotlit-tests/no-class-assertion": "error" },
    },
    {
      files: ["**/*.test.{ts,tsx}"],
      jsPlugins: [join(import.meta.dirname, "oxlint-plugin-tests.ts")],
      rules: { "zotlit-tests/no-markup-assertion": "error" },
    },
    {
      files: [
        "**/*.{test,spec}.{ts,tsx,js,jsx}",
        "**/*.{config,setup}.{ts,js,mjs,cjs}",
        "**/scripts/**",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [parentImportPattern, datePattern],
            paths: uniqueIdPaths,
          },
        ],
      },
    },
    {
      files: ["**/use-unique-id.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [parentImportPattern, datePattern],
            paths: itemQuerySchemaPaths,
          },
        ],
      },
    },
  ],
});
