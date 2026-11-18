import { defineConfig } from "oxlint";

import baseConfig, {
  datePattern,
  testBaselineOverrides,
} from "@zotlit/config/oxlint";
import {
  pluginCodeJsPlugins,
  pluginCodeOverrides,
  pluginCodeRules,
  pluginTestImports,
  runtimeImports,
} from "@zotlit/config/oxlint-plugin-code";

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: pluginCodeJsPlugins,
  rules: pluginCodeRules(runtimeImports),
  overrides: [
    ...pluginCodeOverrides({ testImports: pluginTestImports }),
    // Capability backlog: files that import Effect and still reach the App,
    // grouped by what blocks the change. A file moves off its list when it
    // takes Obsidian from the capability tags.
    {
      // Helpers and constructors that take a raw App object
      // (`readProfileStamp(app.metadataCache, …)`, `vault: app.vault`).
      files: ["src/services/plugin-runtime.ts"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // Legacy emitters, written before no-nanoevents. A file moves off this
      // list when its service converts to Effect.
      files: ["src/services/reader-session/session.ts"],
      rules: { "zotlit-services/no-nanoevents": "off" },
    },
    ...testBaselineOverrides("apps/obsidian"),
    {
      // IndexedDB transactions must finish their request microtasks before a task yield.
      files: [
        "src/services/excerpt-image/store.ts",
        "src/services/excerpt-image/store.browser-test.ts",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            ...runtimeImports,
            paths: runtimeImports.paths.map((path) =>
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
    },
    {
      files: ["vite.config.ts", "src/zt-main.ts"],
      rules: {
        "effecttsgo/global-console": "off",
        "effecttsgo/global-console-in-effect": "off",
      },
    },
    {
      // The rule tests reach the package-local Oxlint modules in scripts/.
      files: ["src/lint/*.test.ts"],
      rules: {
        "no-restricted-imports": ["error", { patterns: [datePattern] }],
      },
    },
    {
      // Code written before the rule; new code follows it, and a file moves
      // off this list when it is next reworked.
      files: [
        "src/views/annot-view/AnnotView.tsx",
        "src/views/annot-view/FilterBar.tsx",
        "src/views/annot-view/tag-editor.tsx",
      ],
      rules: { "zotlit-css/no-obsidian-class": "off" },
    },
    {
      // Background work that stands in no window, which lives as long as the
      // plugin and so as the main window.
      files: ["src/plugin-lifecycle.ts"],
      rules: { "zotlit-obsidian/no-global-timer": "off" },
    },
    {
      // Effect tests written before the rule, in plain Vitest. A file moves
      // off this list when its cases move to it.effect.
      files: ["src/services/zotero-reads/item-query.test.ts"],
      rules: { "zotlit-effect-tests/no-effect-run-in-test": "off" },
    },
    {
      // Node runs these straight from source, where the `@/` alias does not
      // resolve; and they stay independent of plugin code, which
      // tsconfig.node.json cannot type-check. The pin
      // (`@zotlit/plugin-services/core/managed-binary/pin.ts`) is the one
      // shared contract, a module with no imports.
      files: ["scripts/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              datePattern,
              {
                group: ["../src/**"],
                allowTypeImports: true,
                message:
                  "Scripts stay independent of plugin code; a check of plugin code is a Vitest test under src/.",
              },
            ],
          },
        ],
      },
    },
  ],
});
