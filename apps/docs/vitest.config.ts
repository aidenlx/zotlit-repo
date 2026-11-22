import { fumadocsMdx } from "fumadocs-mdx/vite";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

import { scanChinesePages } from "./src/lib/content-scan.ts";
import { scanFirstCommitDays } from "./src/lib/first-commits.ts";
import { scanLearnMedia } from "./src/lib/learn-media.ts";

export default defineConfig({
  define: {
    __DOCS_CHINESE_PAGES__: JSON.stringify(
      scanChinesePages(import.meta.dirname),
    ),
    __LEARN_MEDIA__: JSON.stringify(scanLearnMedia(import.meta.dirname)),
    __FIRST_COMMIT_DAYS__: JSON.stringify(
      scanFirstCommitDays(import.meta.dirname),
    ),
    __MEDIA_URLS__: "{}",
  },
  test: testDefaults,
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  plugins: [fumadocsMdx({ index: false })],
});
