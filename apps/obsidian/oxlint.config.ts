import { defineConfig } from "oxlint";

import baseConfig, {
  datePattern,
  parentImportPattern,
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
      files: ["src/services/citekey-editor/decorate.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          { ...runtimeImports, patterns: [parentImportPattern, datePattern] },
        ],
      },
    },
    {
      // The sink owners may use LogTape directly.
      files: ["src/services/log/**"],
      rules: { "zotlit-logging/no-logtape-in-effect-file": "off" },
    },
    {
      // Logging backlog: rework the file to log through Effect, then remove it from the list.
      files: [
        "src/services/citation-index/sources.ts",
        "src/services/pandoc/document-presentation.ts",
        "src/services/template/actions.ts",
        "src/views/annot-view/view.tsx",
        "src/views/library/item-actions.ts",
        "src/views/library/library-tree.tsx",
        "src/views/library/reading-card.tsx",
        "src/views/library/view.ts",
        "src/views/query-view/view.tsx",
        "src/views/references/view.tsx",
        "src/views/template-workbench/view.tsx",
        "src/views/welcome/banner.tsx",
      ],
      rules: { "zotlit-logging/no-logtape-in-effect-file": "off" },
    },
    {
      // These adapters own effect/rpc worker creation, shutdown and log transport.
      files: ["src/services/citation-parse/worker-host.ts"],
      rules: { "zotlit-services/worker-rpc": "off" },
    },
    // Capability backlog: files that import Effect and still reach the App,
    // grouped by what blocks the change. A file moves off its list when it
    // takes Obsidian from the capability tags.
    {
      // Legacy classes that hold the App (`app`, `#app`, `#deps.app`). A file
      // moves off the list when its service converts to Effect.
      files: [
        "src/services/profile/service.ts",
        "src/services/template/migration.ts",
        "src/services/template/service.ts",
      ],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // Obsidian views and components, which register on their own lifecycle.
      // A file moves off the list when its view reads the tags.
      files: [
        "src/views/annot-view/view.tsx",
        "src/views/references/view.tsx",
        "src/views/template-data-explorer/view.tsx",
        "src/views/template-workbench/view.tsx",
        "src/views/welcome/banner.tsx",
      ],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // No tag member yet: `vault.getName`.
      files: ["src/services/citation-index/cli/register.ts"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // No tag member yet: `vault.adapter`.
      files: [
        "src/services/log/service.ts",
        "src/views/pandoc-export/register.ts",
      ],
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
      // (`documentPresentation(app.metadataCache, …)`,
      // `readProfileStamp(app.metadataCache, …)`, `vault: app.vault`).
      files: [
        "src/services/plugin-runtime.ts",
        "src/services/pandoc/register.ts",
      ],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // Plain async code, or an Effect.fn, that reaches the App through
      // `deps.app`: the deps must carry the tag first.
      files: ["src/views/template-workbench/preview/render.ts"],
      rules: { "zotlit-services/obsidian-capabilities": "off" },
    },
    {
      // Default-runtime backlog: run the Effect through the bridge, a layer context runner or a runtime, then remove the file from the list.
      files: [
        "src/services/batch-run.ts",
        "src/services/citation-index/sources.ts",
        "src/services/profile/service.ts",
        "src/views/annot-view/view.tsx",
        "src/views/library/item-actions.ts",
        "src/views/library/library-tree.tsx",
        "src/views/library/view.ts",
        "src/views/template-workbench/preview/citations.ts",
        "src/views/query-view/table-notes.ts",
        "src/views/query-view/view.tsx",
        "src/views/template-workbench/match-data.ts",
        "src/views/template-workbench/view.tsx",
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
      // Date adapter: Obsidian's YAML frontmatter can hand in a Date.
      files: [
        "src/services/note-index/frontmatter-date.ts",
        "src/services/note-index/frontmatter-date.test.ts",
      ],
      rules: {
        "effecttsgo/global-date": "off",
        "no-restricted-globals": "off",
      },
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
      files: [
        "vite.config.ts",
        "src/services/pandoc/filter/zotlit-cite.pandoc.test.ts",
        "src/zt-main.ts",
        "src/services/log/**",
      ],
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
      // A reading view of a note: the app's own classes draw its Properties
      // block, so the sheet reads as the note does in the editor.
      files: ["src/views/template-workbench/preview/markdown.tsx"],
      rules: { "zotlit-css/no-obsidian-class": "off" },
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
        "src/views/template-workbench/theme.tsx",
      ],
      rules: { "zotlit-css/no-obsidian-class": "off" },
    },
    {
      // Background work that stands in no window, which lives as long as the
      // plugin and so as the main window.
      files: [
        "src/plugin-lifecycle.ts",
        "src/services/item-query/measure.ts",
        "src/services/log/vault-sink.ts",
      ],
      rules: { "zotlit-obsidian/no-global-timer": "off" },
    },
    {
      // Effect tests written before the rule, in plain Vitest. A file moves
      // off this list when its cases move to it.effect.
      files: [
        "src/services/zotero-reads/item-query.test.ts",
        "src/views/template-workbench/view.test.ts",
      ],
      rules: { "zotlit-effect-tests/no-effect-run-in-test": "off" },
    },
    {
      // Tests written before the rule that assert zt: classes; a file moves off
      // this list when its assertions move to behavior.
      files: [
        "src/services/citation-popover/content.test.ts",
        "src/services/citekey-navigation/citation.test.ts",
        "src/services/pandoc/inline-content.test.ts",
        "src/setting-tab/create-profile-modal.test.ts",
        "src/setting-tab/profile-destination-modal.test.ts",
        "src/views/cited-by/CitedBy.test.ts",
        "src/views/references/References.test.ts",
        "src/views/references/view.test.ts",
        "src/views/template-workbench/host.test.ts",
        "src/views/welcome/Welcome.test.ts",
      ],
      rules: { "zotlit-tests/no-class-assertion": "off" },
    },
    {
      // Node runs these straight from source, where the `@/` alias does not
      // resolve; and they stay independent of plugin code, which
      // tsconfig.node.json cannot type-check. The pin is the one shared
      // contract, a module with no imports.
      files: ["scripts/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              datePattern,
              {
                group: ["../src/**", "!../src/services/managed-binary/pin.ts"],
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
