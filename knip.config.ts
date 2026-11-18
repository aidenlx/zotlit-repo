import type { KnipConfig } from "knip";

// The unused-code check: an export or type with no reader in the workspace.
// `pnpm lint:unused` runs it against the baseline in
// packages/scripts/unused-code.json. Entry files are the roots each package is
// built and run from; their own exports count as read.
const config: KnipConfig = {
  include: ["exports", "types", "enumMembers"],
  // A symbol read in its own file has a reader; only its `export` is spare.
  ignoreExportsUsedInFile: true,
  ignoreWorkspaces: ["packages/pdfjs-dist", "video"],
  ignore: ["packages/pdf-structure/src/vendor/**"],
  ignoreIssues: {
    // shadcn/ui components: each file ships the component's whole API.
    "apps/docs/src/components/ui/**": ["exports", "types"],
    // The effectEntry Vite plugin resolves `@effect/vitest` to this wrapper,
    // which mirrors that package's exports for every test that imports it.
    "packages/plugin-kernel/src/effect-vitest.ts": ["exports"],
  },
  workspaces: {
    ".": {
      entry: [
        "*.{js,ts}",
        "skills/*/evals/*.test.mjs",
        ".agents/skills/**/*.mjs",
        ".claude/skills/**/*.mjs",
      ],
    },
    "apps/obsidian": {
      entry: [
        "src/zt-main.ts",
        // Bundled by the embeddedWorker Vite plugin.
        "src/services/*/worker.ts",
        "scripts/**/*.ts",
        "vitest.*.ts",
        "vitest.setup.js",
      ],
    },
    // The plugin packages export their whole source (`./*`), so every module
    // is an entry; their exports still need a reader somewhere in the
    // workspace.
    "packages/plugin-kernel": {
      entry: [
        // The effectEntry Vite plugin resolves `effect`, `effect/Effect` and
        // `@effect/vitest` to these wrappers.
        "src/effect.ts",
        "src/effect-runtime.ts",
        "src/effect-worker.ts",
        "src/effect-worker-runtime.ts",
        "src/effect-vitest.ts",
        "scripts/**/*.ts",
      ],
      includeEntryExports: true,
    },
    "packages/obsidian-kit": {
      includeEntryExports: true,
    },
    "packages/obsidian-desktop": {
      includeEntryExports: true,
    },
    "packages/zotero-reads": {
      includeEntryExports: true,
    },
    "packages/plugin-services": {
      includeEntryExports: true,
    },
    "packages/plugin-messages": {
      // Generated: the facade exports every Message, read or not.
      ignore: ["generated/**"],
    },
    "apps/zotero": {
      entry: [
        "src/bootstrap.ts",
        "src/main.ts",
        "scripts/**/*.ts",
        "vite.config.ts",
        "vite.serve.config.ts",
      ],
      // Loading vite.serve.config.ts needs a local apps/zotero/.env.
      vite: false,
    },
    "apps/docs": {
      entry: ["src/routes/**/*.{ts,tsx}", "scripts/*.ts", "*.config.ts"],
    },
    "packages/db": {
      entry: ["scripts/*.ts"],
      // Loading drizzle.config.js needs a local packages/db/.env.
      drizzle: false,
    },
    "packages/scripts": {
      entry: ["scripts/*.ts"],
    },
    "packages/e2e": {
      entry: [
        "src/*.e2e.ts",
        "src/query-measure.ts",
        // The docs walks and their global setup run under their own Vitest
        // config, and the clip encoder also runs alone to cut a clip again.
        "src/docs-walks/*.walk.ts",
        "src/docs-walks/docs-walk-setup.ts",
        "src/docs-walks/clip-encode.ts",
      ],
    },
  },
};

export default config;
