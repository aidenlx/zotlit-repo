import preact from "@preact/preset-vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";
import {
  obsidianMock,
  obsidianSetupFile,
  packageSource,
} from "@zotlit/obsidian-kit/vitest";
import { effectEntry } from "@zotlit/plugin-kernel/vite";

import { pandocFilterVariants } from "./scripts/lua-filter.ts";

/** The plugin code the effectEntry wrappers apply to. */
const pluginCode = [
  fileURLToPath(new URL("./src/", import.meta.url)),
  fileURLToPath(new URL("./scripts/", import.meta.url)),
  packageSource(import.meta.resolve("@zotlit/obsidian-kit/package.json")),
  packageSource(import.meta.resolve("@zotlit/obsidian-desktop/package.json")),
  packageSource(import.meta.resolve("@zotlit/zotero-reads/package.json")),
  packageSource(import.meta.resolve("@zotlit/plugin-services/package.json")),
  packageSource(import.meta.resolve("@zotlit/annotations/package.json")),
];

export default defineConfig({
  resolve: {
    alias: {
      // The citations read the Obsidian kit and `obsidian`, a types-only
      // package; runtime imports load the stand-in.
      obsidian: obsidianMock,
    },
  },
  // The build constants, as the plugin's own test config defines them.
  define: {
    __DEV__: JSON.stringify(true),
    __WEB_WORKBENCH_ENABLED__: JSON.stringify(true),
    __ANNOTATION_SUGGESTER_ENABLED__: JSON.stringify(true),
    __DOCS_SITE_URL__: JSON.stringify("https://zotlit.aidenlx.site"),
    // Resolving the real pin needs the network; a test that cares about engine
    // metadata takes it as an argument rather than reading this placeholder.
    __PANDOC_ENGINE__: JSON.stringify({
      version: "0.0.0",
      url: "https://example.invalid/pandoc.wasm.zip",
      sha256: "0".repeat(64),
    }),
    __CHINESE_SEGMENTER__: JSON.stringify({
      version: "0.0.0",
      url: "https://example.invalid/jieba_rs_wasm_bg.wasm",
      sha256: "0".repeat(64),
    }),
  },
  plugins: [
    effectEntry("renderer", { vitest: true, scopes: pluginCode }),
    // The views import `react`, which the plugin bundles as Preact.
    preact(),
    pandocFilterVariants(),
  ],
  test: {
    ...testDefaults,
    // `include`/`exclude` live on the projects below: a root `include` would
    // survive beside each project's own and widen it back to everything.
    environment: "node",
    clearMocks: true,
    server: {
      deps: {
        // Run through Vite so its `react` import lands on the Preact alias
        // like our own sources; externalized, it would load real React.
        inline: ["@effect/atom-react"],
      },
    },
    setupFiles: [obsidianSetupFile],
    globalSetup: [
      ...testDefaults.globalSetup,
      fileURLToPath(
        import.meta.resolve("@zotlit/plugin-messages/vitest-setup"),
      ),
    ],
    projects: [
      {
        extends: true,
        test: {
          include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
          exclude: [
            ...testDefaults.exclude,
            // Needs a native Pandoc; the `pandoc` project runs it.
            "src/**/*.pandoc.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "pandoc",
          include: ["src/**/*.pandoc.test.ts"],
          // The style validator reads XML through the DOMParser Obsidian's
          // renderer supplies.
          environment: "happy-dom",
        },
      },
    ],
  },
});
