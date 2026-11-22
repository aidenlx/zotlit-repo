import { recommended } from "@effect/tsgo/oxlint-presets";
import { join } from "node:path";
import { defineConfig } from "oxlint";
import type { DummyRuleMap, OxlintOverride } from "oxlint";

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

export const uniqueIdPaths = ["react", "preact/compat", "preact/hooks"].map(
  (name) => ({
    name,
    importNames: ["useId"],
    message:
      "Use useUniqueId from @zotlit/ui: useId counts within one Preact root, so two views in one window share its ids.",
  }),
);

const dateFix =
  "Use Temporal outside Effect and DateTime in Effect code (DateTime.now or Clock for the current time). A library that takes or gives a Date converts in its adapter module.";

export const dateGlobals = {
  globals: [{ name: "Date", message: dateFix }],
  checkGlobalObject: true,
};

export const dateTypes = { types: { Date: dateFix } };

export const datePattern = {
  group: ["date-fns", "date-fns/**", "dayjs", "dayjs/**"],
  message: dateFix,
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

export const hostModulePattern = {
  regex:
    "^(?:obsidian|electron|@zotlit/pdf-reader/obsidian|@zotlit/db/client/node)(?:/.*)?$|^#client/node\\.ts$",
  message:
    "Engine source runs on every host. Take the host capability as a value; only a desktop host and Node tests load Obsidian, Electron or @zotlit/db/client/node.",
};

export function engineBoundaryRules(): DummyRuleMap {
  return {
    "import/no-nodejs-modules": "error",
    "no-restricted-imports": [
      "error",
      {
        patterns: [parentImportPattern, datePattern, hostModulePattern],
        paths: [...itemQuerySchemaPaths, ...uniqueIdPaths],
      },
    ],
  };
}

export function engineNodeOnlyOverride(
  adapters: string[] = [],
): OxlintOverride {
  return {
    files: [
      "**/*.{test,spec,bench}.{ts,tsx,js,mjs}",
      "**/*.{config,setup}.{ts,js,mjs,cjs}",
      "scripts/**",
      ...adapters,
    ],
    rules: { "import/no-nodejs-modules": "off" },
  };
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
  ],
  rules: {
    "zotlit-build/no-undeclared-env": "error",
    "zotlit-build/no-app-path": "error",
    "zotlit-comments/no-tracker-reference": "error",
    "import/extensions": [
      "error",
      "always",
      { ignorePackages: true, checkTypeImports: true },
    ],
    "no-restricted-globals": ["error", dateGlobals],
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
    "no-restricted-imports": [
      "error",
      {
        patterns: [parentImportPattern, datePattern],
        paths: [...itemQuerySchemaPaths, ...uniqueIdPaths],
      },
    ],
    "typescript/consistent-type-imports": [
      "error",
      { fixStyle: "separate-type-imports", disallowTypeAnnotations: false },
    ],
    "import/consistent-type-specifier-style": ["error", "prefer-top-level"],
  },
  overrides: [
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
