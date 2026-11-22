import type { KnipConfig } from "knip";

const config: KnipConfig = {
  include: ["exports", "types", "enumMembers"],
  ignoreExportsUsedInFile: true,
  ignoreWorkspaces: ["packages/pdfjs-dist", "packages/pdfjs", "video"],
  ignore: ["packages/pdf-structure/src/vendor/**"],
  ignoreIssues: {
    "apps/docs/src/components/ui/**": ["exports", "types"],
    "packages/plugin-kernel/src/effect-vitest.ts": ["exports"],
    "packages/annotations/src/__fixtures__/excerpt-image/renderer-{hash,host}.ts":
      ["exports"],
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
        "src/services/*/worker.ts",
        "scripts/**/*.ts",
        "vitest.*.ts",
        "vitest.setup.js",
      ],
    },
    "packages/plugin-kernel": {
      entry: [
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
    "packages/annotations": {
      includeEntryExports: true,
    },
    "packages/citations": {
      includeEntryExports: true,
    },
    "packages/notes": {
      includeEntryExports: true,
    },
    "packages/template-workbench": {
      includeEntryExports: true,
      ignore: ["src/core/language/eta-parser.terms.ts"],
    },
    "packages/query-views": {
      includeEntryExports: true,
    },
    "packages/library-view": {
      includeEntryExports: true,
    },
    "packages/plugin-messages": {
      ignore: ["generated/**"],
    },
    "packages/reader-messages": {
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
      vite: false,
    },
    "apps/docs": {
      entry: ["src/routes/**/*.{ts,tsx}", "scripts/*.ts", "*.config.ts"],
    },
    "packages/db": {
      entry: ["scripts/*.ts"],
      drizzle: false,
    },
    "packages/pdf-reader": {
      entry: [
        "src/core/index.ts",
        "src/obsidian/index.ts",
        "src/pdfjs.ts",
        "src/**/*.browser-test.ts",
        "test/host.ts",
        "build/*.ts",
      ],
    },
    "packages/scripts": {
      entry: ["scripts/*.ts"],
    },
    "packages/resource-pack": {
      entry: ["src/**/*.browser-test.ts"],
    },
    "apps/resources": {
      entry: ["scripts/*.ts"],
    },
    "packages/e2e": {
      entry: [
        "src/*.e2e.ts",
        "src/query-measure.ts",
        "src/docs-walks/*.walk.ts",
        "src/docs-walks/docs-walk-setup.ts",
        "src/docs-walks/clip-encode.ts",
      ],
    },
  },
};

export default config;
