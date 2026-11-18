import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

import { testDefaults } from "@zotlit/config/vitest";

import { effectEntry } from "./scripts/effect-entry.ts";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  // The build constants the kernel reads (src/typings/build-env.d.ts), as
  // the plugin's own test config defines them.
  define: {
    __WEB_WORKBENCH_ENABLED__: JSON.stringify(true),
    __ANNOTATION_SUGGESTER_ENABLED__: JSON.stringify(true),
    __DOCS_SITE_URL__: JSON.stringify("https://zotlit.aidenlx.site"),
  },
  plugins: [effectEntry("renderer", { vitest: true })],
  test: {
    ...testDefaults,
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    clearMocks: true,
    globalSetup: [
      ...testDefaults.globalSetup,
      fileURLToPath(
        import.meta.resolve("@zotlit/plugin-messages/vitest-setup"),
      ),
    ],
  },
});
