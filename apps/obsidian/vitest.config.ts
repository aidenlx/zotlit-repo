import preact from "@preact/preset-vite";
import { resolve } from "node:path";
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

const packageRoot = import.meta.dirname;

/**
 * Run under the `happy-dom-native-response` project below, not the default
 * `node` environment.
 *
 * @see {@link ./vitest.env.happy-dom-native-response.ts}
 */
const HAPPY_DOM_NATIVE_RESPONSE_FILES = [
  "src/services/pandoc/citation-locale.integration.test.ts",
  "src/services/pandoc/citation-presentation.integration.test.ts",
  "src/services/pandoc/document-language.integration.test.ts",
  "src/services/citation-text/document-citation-set.integration.test.ts",
];

export default defineConfig({
  resolve: {
    alias: {
      // The published `obsidian` package is types-only; redirect runtime
      // imports to our local mock so tests can `import { ... } from "obsidian"`.
      obsidian: obsidianMock,
      // Pretext measures text with a canvas, which the test DOM lacks.
      "@chenglou/pretext": resolve(packageRoot, "__mocks__/pretext.ts"),
      "virtual:citation-parse-worker": resolve(
        packageRoot,
        "__mocks__/worker-source.ts",
      ),
    },
    tsconfigPaths: true,
  },
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
    effectEntry("renderer", {
      vitest: true,
      scopes: [
        resolve(packageRoot, "src"),
        resolve(packageRoot, "scripts"),
        packageSource(import.meta.resolve("@zotlit/obsidian-kit/package.json")),
        packageSource(
          import.meta.resolve("@zotlit/obsidian-desktop/package.json"),
        ),
        packageSource(import.meta.resolve("@zotlit/zotero-reads/package.json")),
        packageSource(
          import.meta.resolve("@zotlit/plugin-services/package.json"),
        ),
      ],
    }),
    preact(),
    pandocFilterVariants(),
  ],
  test: {
    ...testDefaults,
    // `include`/`exclude` live on the two projects below, not here: Vite's
    // `mergeConfig` concatenates array fields a project shares with this root
    // config, so an `include` set here would survive alongside each project's
    // own and widen it back to everything. Keeping them project-only turns
    // that merge into a plain assignment instead.
    environment: "node",
    clearMocks: true,
    server: {
      deps: {
        // Run through Vite so its `react` import lands on the Preact alias
        // like our own sources; externalized, it would load real React.
        inline: [
          "@effect/atom-react",
          "@uiw/react-codemirror",
          "@tanstack/react-virtual",
        ],
      },
    },
    setupFiles: [obsidianSetupFile],
    globalSetup: [
      ...testDefaults.globalSetup,
      fileURLToPath(
        import.meta.resolve("@zotlit/plugin-messages/vitest-setup"),
      ),
    ],
    // `// @vitest-environment` can't name a project by file path (its pragma only accepts `[\w-]+`), so the split happens here instead.
    projects: [
      {
        extends: true,
        test: {
          include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
          exclude: [
            ...testDefaults.exclude,
            ...HAPPY_DOM_NATIVE_RESPONSE_FILES,
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
      {
        extends: true,
        test: {
          name: "happy-dom-native-response",
          include: HAPPY_DOM_NATIVE_RESPONSE_FILES,
          environment: "./vitest.env.happy-dom-native-response.ts",
        },
      },
    ],
  },
});
