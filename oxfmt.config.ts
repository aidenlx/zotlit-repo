import { defineConfig } from "oxfmt";

import baseConfig from "./packages/config/oxfmt.base.ts";

export default defineConfig({
  ...baseConfig,
  ignorePatterns: [
    ...baseConfig.ignorePatterns,
    ".scratch/**",
    "tests/fixture-vault-*/**",
    "packages/scripts/lib/fixture/vault-plugins/**",
    "packages/scripts/lib/fixture/vault-pages/**",
    "packages/scripts/lib/fixture/graph-pages/**",
    "packages/pdfjs-dist/**",
    "packages/pdfjs/dist/**",
    "packages/pdf-structure/src/vendor/*.js",
    "packages/zotero-types/zotero-schema/**",
    "packages/notes/src/core/template-preview/samples/*.json",
    "video/**",
  ],
});
