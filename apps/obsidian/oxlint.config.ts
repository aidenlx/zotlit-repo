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
    {
      // Logging backlog: rework the file to log through Effect, then remove it from the list.
      files: [
        "src/views/annot-view/view.tsx",
        "src/views/library/item-actions.ts",
        "src/views/library/library-tree.tsx",
        "src/views/library/reading-card.tsx",
        "src/views/library/view.ts",
        "src/views/query-view/view.tsx",
        "src/views/welcome/banner.tsx",
      ],
      rules: { "zotlit-logging/no-logtape-in-effect-file": "off" },
    },
    // Capability backlog: files that import Effect and still reach the App,
    // grouped by what blocks the change. A file moves off its list when it
    // takes Obsidian from the capability tags.
    {
      // Obsidian views and components, which register on their own lifecycle.
      // A file moves off the list when its view reads the tags.
      files: ["src/views/annot-view/view.tsx", "src/views/welcome/banner.tsx"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // No tag member yet: `metadataCache.getCache`. The file also calls
      // `metadataCache.getFirstLinkpathDest` (the MetadataCache tag's
      // `firstLinkpathDest`) and `vault.getFileByPath`, which the Vault tag
      // has.
      files: ["src/views/query-view/table-notes.ts"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // No tag member yet: the side splits (library/view.ts), and the raw
      // workspace that the editor lookup takes (library/view.ts,
      // library/item-actions.ts).
      files: ["src/views/library/item-actions.ts", "src/views/library/view.ts"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // Listens to the workspace's `layout-change` on the App; the Workspace
      // tag's `changes` now carries it.
      files: ["src/views/welcome/register.ts"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // Helpers and constructors that take a raw App object
      // (`readProfileStamp(app.metadataCache, …)`, `vault: app.vault`).
      files: ["src/services/plugin-runtime.ts"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // Default-runtime backlog: run the Effect through the bridge, a layer context runner or a runtime, then remove the file from the list.
      files: [
        "src/views/annot-view/view.tsx",
        "src/views/library/item-actions.ts",
        "src/views/library/library-tree.tsx",
        "src/views/library/view.ts",
        "src/views/query-view/table-notes.ts",
        "src/views/query-view/view.tsx",
        "src/views/welcome/connection.ts",
      ],
      rules: { "zotlit-services/no-default-runtime": "off" },
    },
    {
      // Clock backlog: read time through Clock (`Clock.currentTimeMillis` or `DateTime.now` in Effect code; `instantClock(yield* Clock.Clock)` from `@/lib/effect-clock` for a non-Effect core), then remove the file from the list.
      files: [
        "src/services/item-query/answer.ts",
        "src/services/item-query/job.ts",
        "src/services/item-query/measure.ts",
        "src/services/item-query/trace.ts",
      ],
      rules: { "zotlit-services/clock-time": "off" },
    },
    {
      // Legacy emitters, written before no-nanoevents. A file moves off this
      // list when its service converts to Effect.
      files: [
        "src/services/reader-session/session.ts",
        "src/views/library/item-drag.test.ts",
        "src/views/library/view.test.ts",
        "src/views/query-view/table-notes.ts",
      ],
      rules: { "zotlit-services/no-nanoevents": "off" },
    },
    {
      files: ["src/views/annot-view/*.{ts,tsx}"],
      excludeFiles: ["**/*.test.{ts,tsx}"],
      rules: { "zotlit-design/annotation-view": "error" },
    },
    ...testBaselineOverrides("apps/obsidian"),
    {
      // Guarded private API reaches its surface through obsidian-ex.d.ts.
      files: ["src/views/query-view/obsidian-private/**"],
      rules: { "zotlit-private/no-unknown-cast": "error" },
    },
    {
      // A test's fake App stands in for the whole surface.
      files: ["src/views/query-view/obsidian-private/*.test.ts"],
      rules: { "zotlit-private/no-unknown-cast": "off" },
    },
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
        "src/views/query-view/sort-control.tsx",
        "src/views/query-view/table-layout.tsx",
      ],
      rules: { "zotlit-css/no-obsidian-class": "off" },
    },
    {
      // Background work that stands in no window, which lives as long as the
      // plugin and so as the main window.
      files: ["src/plugin-lifecycle.ts", "src/services/item-query/measure.ts"],
      rules: { "zotlit-obsidian/no-global-timer": "off" },
    },
    {
      // Effect tests written before the rule, in plain Vitest. A file moves
      // off this list when its cases move to it.effect.
      files: ["src/services/zotero-reads/item-query.test.ts"],
      rules: { "zotlit-effect-tests/no-effect-run-in-test": "off" },
    },
    {
      // Tests written before the rule that assert zt: classes; a file moves off
      // this list when its assertions move to behavior.
      files: ["src/views/welcome/Welcome.test.ts"],
      rules: { "zotlit-tests/no-class-assertion": "off" },
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
